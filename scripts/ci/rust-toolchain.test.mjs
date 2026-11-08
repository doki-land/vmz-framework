/**
 * 工具链 pin 回归：仓根文件必须是精确 pin，浮动 channel 一律拒绝。
 * 工作流回归：写 `$GITHUB_OUTPUT` 的 step 必须显式 `shell: bash`，工具链解析
 * step 还必须断言 channel 非空，否则 Windows runner 上空 output 会静默通过。
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EXACT_PIN, resolveToolchainChannel } from './rust-toolchain.mjs';

const WORKFLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const TOOLCHAIN_RESOLVER = 'scripts/ci/rust-toolchain.mjs';

async function fixture(source) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vmz-rust-toolchain-'));
    await writeFile(path.join(root, 'rust-toolchain.toml'), source);
    return root;
}

async function workflowFiles() {
    const entries = await readdir(WORKFLOW_DIR, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
        .map((entry) => path.join(WORKFLOW_DIR, entry.name));
}

/** 以最小缩进的 `- name|uses|run` 行为 step 边界，把工作流切成 step 块。 */
function splitSteps(text) {
    const lines = text.split(/\r?\n/);
    const indents = [...text.matchAll(/^([ \t]*)- (?:name|uses|run):/gm)].map((match) => match[1].length);
    if (indents.length === 0) return [];
    const stepIndent = Math.min(...indents);
    const boundary = new RegExp(`^[ \\t]{${stepIndent}}- (?:name|uses|run):`);
    const steps = [];
    let current = null;
    for (const line of lines) {
        if (boundary.test(line)) {
            if (current) steps.push(current);
            current = [line];
            continue;
        }
        if (current) current.push(line);
    }
    if (current) steps.push(current);
    return steps;
}

function hasBashShell(step) {
    return step.some((line) => /^[ \t]*shell:[ \t]*['"]?bash['"]?[ \t]*$/.test(line));
}

/** step 前的注释行归属于上一个 step，判定只看真实指令行。 */
function codeLines(step) {
    return step.filter((line) => !/^[ \t]*#/.test(line));
}

test('仓根的 `rust-toolchain.toml` 是精确 pin', async () => {
    assert.match(await resolveToolchainChannel(), EXACT_PIN);
});

test('浮动 channel 被拒绝', async () => {
    const root = await fixture('[toolchain]\nchannel = "nightly"\n');
    await assert.rejects(resolveToolchainChannel(root), /不是精确 pin/);
});

test('缺少 channel 被拒绝', async () => {
    const root = await fixture('[toolchain]\ncomponents = ["rustfmt"]\n');
    await assert.rejects(resolveToolchainChannel(root), /缺少/);
});

test('带日期的 nightly 与具体版本号被接受', async () => {
    assert.equal(
        await resolveToolchainChannel(await fixture('[toolchain]\nchannel = "nightly-2026-11-06"\n')),
        'nightly-2026-11-06',
    );
    assert.equal(await resolveToolchainChannel(await fixture('[toolchain]\nchannel = "1.101.0"\n')), '1.101.0');
});

test('写 `$GITHUB_OUTPUT` 的 step 显式声明 `shell: bash`', async () => {
    const files = await workflowFiles();
    assert.ok(files.length > 0, '未找到工作流文件');
    const offenders = [];
    for (const file of files) {
        for (const step of splitSteps(await readFile(file, 'utf8'))) {
            const code = codeLines(step);
            const writesOutput = code.some((line) => line.includes('$GITHUB_OUTPUT'));
            if (writesOutput && !hasBashShell(code)) offenders.push(`${path.basename(file)}: ${step[0].trim()}`);
        }
    }
    assert.deepEqual(offenders, [], `默认 shell 下写不出 output: ${offenders.join(', ')}`);
});

test('工具链解析 step 断言 channel 非空', async () => {
    const files = await workflowFiles();
    const offenders = [];
    let resolvers = 0;
    for (const file of files) {
        for (const step of splitSteps(await readFile(file, 'utf8'))) {
            const code = codeLines(step);
            const body = code.join('\n');
            if (!body.includes(TOOLCHAIN_RESOLVER) || !body.includes('$GITHUB_OUTPUT')) continue;
            resolvers += 1;
            if (!hasBashShell(code)) offenders.push(`${path.basename(file)}: 缺少 \`shell: bash\``);
            else if (!/test -n "\$channel"/.test(body)) offenders.push(`${path.basename(file)}: 缺少非空断言`);
        }
    }
    assert.ok(resolvers > 0, '未找到工具链解析 step');
    assert.deepEqual(offenders, [], `${offenders.join(', ')}`);
});

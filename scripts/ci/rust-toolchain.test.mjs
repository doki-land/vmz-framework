/**
 * 工具链 pin 回归：仓根文件必须是精确 pin，浮动 channel 一律拒绝。
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { EXACT_PIN, resolveToolchainChannel } from './rust-toolchain.mjs';

async function fixture(source) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vmz-rust-toolchain-'));
    await writeFile(path.join(root, 'rust-toolchain.toml'), source);
    return root;
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

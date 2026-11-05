#!/usr/bin/env node
/**
 * Real-binding smoke for static `node:` builtins in the pack chain.
 *
 * `cargo test -p vmz-pack` proves the emit decisions on synthetic inputs. This
 * script drives the same decisions through the shipped N-API binding, so the
 * wire (`packPlan` JSON in / JSON out) and the native build are proven together:
 *
 * 1. Node target keeps the builtin as a chunk-level external import, renames the
 *    local binding out of the collision scope, and the emitted chunk still runs.
 * 2. Browser target still rejects the same input explicitly.
 *
 * Usage:
 *   node scripts/dev/pack-node-binding-smoke.mjs
 *   node scripts/dev/pack-node-binding-smoke.mjs --binding <path/to/vmz.win32-x64-msvc.node>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const failures = [];

function check(condition, message) {
    if (!condition) failures.push(message);
}

function resolveDefaultBinding() {
    const override = process.env.VMZ_NATIVE_BINDING;
    if (override) return override;
    const flag = process.argv.indexOf('--binding');
    if (flag > 0) {
        const value = process.argv[flag + 1];
        if (!value) throw new Error('--binding needs a path');
        return value;
    }
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const candidates = [
        path.join(repoRoot, 'packages/runtimes/vmz/node_modules/@vmz/vmz-win32-x64/vmz.win32-x64-msvc.node'),
        path.join(repoRoot, 'packages/runtimes/vmz-win32-x64/vmz.win32-x64-msvc.node'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`vmz native binding not found, looked in:\n${candidates.join('\n')}\nRun: pnpm napi:build`);
}

const bindingPath = resolveDefaultBinding();
const native = require(bindingPath);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-pack-node-binding-'));
const entryPath = path.join(root, 'entry.js');
fs.writeFileSync(
    entryPath,
    "import { readFile } from 'node:fs/promises';\nimport 'node:os';\nexport const run = readFile;\n",
);

function request(target) {
    return JSON.stringify({
        entries: [{ logical: 'main', path: entryPath }],
        target,
        root,
        uses: [{ logical: 'main', execution: 'full', exports: { kind: 'all' } }],
        publicBase: '/_vmz/',
    });
}

function entryArtifact(response) {
    return response.plan?.artifacts?.find((artifact) => artifact.chunkId.startsWith('entry/')) ?? null;
}

console.log(`binding: ${bindingPath}`);

const nodeResponse = JSON.parse(native.packPlan(request('node')));
check(nodeResponse.ok === true, 'Node target must produce a plan');
const nodeEntry = entryArtifact(nodeResponse);
check(nodeEntry !== null, 'Node target must emit an entry chunk');
const nodeCode = nodeEntry?.code ?? '';

check(
    /import\s+\{\s*readFile as readFile__vmz_node\d+\s*\}\s+from\s+"node:fs\/promises";/.test(nodeCode),
    `Node target must keep a chunk-level external import with a renamed binding:\n${nodeCode}`,
);
check(/import\s+"node:os";/.test(nodeCode), `Node target must keep the side-effect import:\n${nodeCode}`);

const nodeCodes = nodeResponse.diagnostics.map((diagnostic) => diagnostic.code);
check(
    nodeCodes.includes('vmz::pack::emit::node_builtin_static_kept'),
    `Node target must report node_builtin_static_kept, got: ${nodeCodes.join(', ')}`,
);
check(
    !nodeCodes.includes('vmz::pack::emit::node_builtin_static_unsupported'),
    `Node target must not reject the builtin, got: ${nodeCodes.join(', ')}`,
);

// Executable proof: the emitted chunk must load in Node and the renamed binding
// must still be the real `readFile`.
if (nodeEntry) {
    const chunkPath = path.join(root, nodeEntry.fileName);
    fs.writeFileSync(chunkPath, nodeEntry.code);
    const probePath = path.join(root, 'probe.txt');
    fs.writeFileSync(probePath, 'vmz pack node binding smoke\n');
    const module = await import(pathToFileURL(chunkPath).href);
    check(typeof module.run === 'function', 'emitted `run` must be a function');
    if (typeof module.run === 'function') {
        const text = await module.run(probePath, 'utf8');
        check(text === 'vmz pack node binding smoke\n', 'emitted binding must read the probe file');
    }
}

const browserResponse = JSON.parse(native.packPlan(request('browser')));
check(browserResponse.ok === false, 'Browser target must reject a static `node:` import');
const browserCodes = browserResponse.diagnostics.map((diagnostic) => diagnostic.code);
check(
    browserCodes.includes('vmz::pack::emit::node_builtin_static_unsupported'),
    `Browser target must report node_builtin_static_unsupported, got: ${browserCodes.join(', ')}`,
);

if (failures.length > 0) {
    console.error('pack node binding smoke: FAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log('pack node binding smoke: PASS');
console.log(`  node: ${nodeEntry.fileName} code=${nodeCode.length}B diagnostics=${nodeCodes.join(', ')}`);
console.log(`  browser: rejected with ${browserCodes.join(', ')}`);

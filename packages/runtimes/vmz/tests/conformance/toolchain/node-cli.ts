/**
 * gate: Node `vmz build` uses N-API Workspace; rebuild path never spawns cargo/vmz-tools.
 *
 * Usage: node scripts/_gate_n2_node_cli.mjs
 * Requires: pnpm napi:build
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { createDevSession, createWorkspace, runCli } from 'vmz';

const root = repoRoot(import.meta.url);
const bin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n2-'));
const src = path.join(dir, 'src');
const pages = path.join(src, 'pages');
fs.mkdirSync(pages, { recursive: true });
const vmzFile = path.join(src, 'Application.vmz');
fs.writeFileSync(vmzFile, `<template><p>n2</p></template>\n<script client>\nexport default class Application {}\n</script>\n`);
// The route catalog needs at least one page unit with a path pattern, otherwise
// `emitRouteCatalog` rejects the build. A single application unit is not a page.
fs.writeFileSync(
    path.join(pages, 'index.vmz'),
    `<template><p>index</p></template>\n<script client>\nexport default class IndexPage {}\n</script>\n`,
);
const outDir = path.join(dir, 'dist');

console.log(' gate: vmz build via Node bin…');
const build = spawnSync(process.execPath, [bin, 'build', dir, '--out-dir', outDir], {
    cwd: root,
    encoding: 'utf8',
});
if (build.status !== 0) {
    fail(`vmz build exit ${build.status}\n${build.stderr}\n${build.stdout}`);
}
// The assembly subdirectory depends on delivery (`web-ssr/`, `web-static/`, …),
// so locate the emitted program instead of pinning one layout.
const emitted = (
    fs.readdirSync(outDir, { recursive: true, encoding: 'utf8' }) as string[]
).filter((p) => p.endsWith('Application.program.json'));
if (emitted.length === 0) {
    fail('missing Application.program.json after Node build');
}

console.log(' gate: runCli check…');
const checkCode = await runCli(['check', dir]);
if (checkCode !== 0) fail(`runCli check → ${checkCode}`);

console.log(' gate: DevSession.rebuild must not spawn cargo/vmz-tools…');
const session = createDevSession({
    project: dir,
    outDir: path.join(dir, 'dist2'),
    spawnHostFn: () => {
        throw new Error('spawnHost should not run in rebuild-only gate');
    },
    softReloadFn: async () => ({ ok: true }),
    createWorkspaceFn: (opts) => createWorkspace(opts),
});

// Patch global spawn detection via env marker — rebuild API is the contract.
const before = session.rebuild([{ path: vmzFile, kind: 'update' }]);
const after = session.rebuild([{ path: vmzFile, kind: 'update' }]);
if ((before.diagnostics || []).some((d) => d.severity === 'error')) {
    fail(`rebuild#1 errors: ${JSON.stringify(before.diagnostics)}`);
}
if ((after.diagnostics || []).some((d) => d.severity === 'error')) {
    fail(`rebuild#2 errors: ${JSON.stringify(after.diagnostics)}`);
}
await session.stop();

// Prove Node bin path does not invoke cargo for build (scan argv of this gate's build spawn above).
if (String(build.stderr || '').includes('Running `') && String(build.stderr).includes('vmz-tools')) {
    fail('Node vmz build appears to have spawned cargo vmz-tools');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: Node CLI build + Workspace rebuild (no per-rebuild CLI spawn)');

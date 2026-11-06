/**
 * gate: dev pack reuse is decided by pack-input bytes, not by rebuild count.
 *
 * Builds a real project, runs the real browser pack, then captures the same
 * snapshot the dev session keeps. Reuse must be allowed only when every input
 * byte equals the previous pack: touching an input without changing bytes must
 * still reuse, and any real input/output change must repack.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { packFromDeploymentIr } from 'vmz';
import {
    capturePackInputSnapshot,
    missingPackOutput,
    packInputsChangedReason,
} from '../../../dist/dev/dev-session.js';

const root = repoRoot(import.meta.url);
const bin = vmzBin(root);

function fail(msg) {
    console.error(`dev-pack-input-skip GATE FAIL: ${msg}`);
    process.exit(1);
}

function build(project, outDir) {
    const r = spawnSync(process.execPath, [bin, 'build', project, '--out-dir', outDir], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if ((r.status ?? 1) !== 0) {
        fail(`vmz build exit ${r.status}\n${r.stderr || ''}\n${r.stdout || ''}`);
    }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-pack-input-'));
const src = path.join(dir, 'src');
const pages = path.join(src, 'pages');
const buildRoot = path.join(dir, 'dist');
fs.mkdirSync(pages, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pack-input-skip', private: true, type: 'module' }));
// The snapshot refuses to reuse when the nearest lockfile is missing.
fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
const applicationFile = path.join(src, 'Application.vmz');
fs.writeFileSync(
    applicationFile,
    `<template><p>pack skip</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
);
const pageFile = path.join(pages, 'index.vmz');
fs.writeFileSync(
    pageFile,
    `<template><main><h1>home</h1></main></template>\n<script client>\nexport default class Index {}\n</script>\n`,
);

console.log('dev-pack-input-skip: build project…');
build(dir, buildRoot);
// Default delivery nests under `profiles.*.name` (builtin `web-ssr`).
const outDir = fs.existsSync(path.join(buildRoot, 'web-ssr', 'vmz-deployment.json'))
    ? path.join(buildRoot, 'web-ssr')
    : buildRoot;
if (!fs.existsSync(path.join(outDir, 'vmz-deployment.json'))) {
    fail('build must emit vmz-deployment.json (deployment IR drives pack origins)');
}
if (!fs.existsSync(path.join(outDir, 'entry-client.js'))) {
    fail('build must emit entry-client.js (browser pack bootstrap entry)');
}

console.log('dev-pack-input-skip: real browser pack…');
const packed = packFromDeploymentIr(outDir, { projectRoot: dir });
const manifest = packed.manifest;
if (!fs.existsSync(path.join(outDir, '_vmz', 'pack-manifest.json'))) {
    fail('pack must write _vmz/pack-manifest.json');
}

const snapshot = capturePackInputSnapshot(manifest, outDir, dir);
if (!snapshot) {
    fail('capturePackInputSnapshot returned null — dev would repack every rebuild');
}
if (!snapshot.files.length) fail('pack input snapshot recorded no module inputs');

console.log(`dev-pack-input-skip: snapshot inputs=${snapshot.files.length}…`);
const unchanged = packInputsChangedReason(snapshot, outDir);
if (unchanged !== null) fail(`untouched artifacts must reuse the pack, got: ${unchanged}`);

// Rewrite the exact same bytes: content判据必须忽略 mtime。
const inputFile = snapshot.files.find((f) => f.path.startsWith(dir)) ?? snapshot.files[0];
const original = fs.readFileSync(inputFile.path);
fs.writeFileSync(inputFile.path, original);
const touched = packInputsChangedReason(snapshot, outDir);
if (touched !== null) fail(`same bytes must still reuse, got: ${touched}`);

// Real byte change on a module input repacks and reports the file.
const changed = `${original.toString('utf8')}\n/* pack-input-skip probe */\n`;
fs.writeFileSync(inputFile.path, changed);
const reason = packInputsChangedReason(snapshot, outDir);
if (!reason?.includes(inputFile.path)) fail(`input byte change must report ${inputFile.path}, got: ${reason}`);

// Lockfile bytes are part of the decision (dependency graph can move without src changes).
fs.appendFileSync(path.join(dir, 'pnpm-lock.yaml'), '# pack-input-skip probe\n');
const lockReason = packInputsChangedReason(snapshot, outDir);
if (lockReason !== 'lockfile changed') fail(`lockfile byte change must repack, got: ${lockReason}`);

// Pack outputs are part of the contract: a missing chunk must reject manifest reuse.
const outputFile = (manifest.chunks ?? []).find((c) => typeof c.fileName === 'string' && c.fileName)?.fileName;
if (!outputFile) fail('pack manifest exposes no chunk file to probe');
const missing = missingPackOutput(manifest, outDir);
if (missing !== null) fail(`complete pack must not report missing output, got: ${missing}`);
fs.rmSync(path.join(outDir, '_vmz', 'pack', outputFile), { force: true });
const missingAfterDelete = missingPackOutput(manifest, outDir);
if (missingAfterDelete !== outputFile) {
    fail(`deleted chunk ${outputFile} must reject reuse, got: ${missingAfterDelete}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('dev-pack-input-skip GATE OK: byte-identical inputs reuse the pack, byte changes and missing outputs repack');

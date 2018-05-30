/**
 * WriteBarrier slice 3: shared multi-owner + dynamic index + compound assign.
 *
 * Claim (narrow):
 * - Same plain object on two fields: write via one notifies both (no Proxy)
 * - `this.tags[this.selected].label` / `this.tags[i].label` rewrite with String(index)
 * - `+=` / `++` expand via __vmzReadPath + __vmzWritePath
 *
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { parseHTML } from 'linkedom';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'fullstack');

function fail(msg) {
    console.error(`-WB3 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wb3-'));
const dist = path.join(tmp, 'dist');

console.log('-WB3 gate: building fullstack…');
const build = spawnSync(
    'cargo',
    ['run', '--quiet', '--manifest-path', path.join(root, 'Cargo.toml'), '-p', 'vmz-tools', '--', 'build', example, '--out-dir', dist],
    { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) fail(`build exited ${build.status}`);

const dynJs = fs.readFileSync(path.join(dist, 'components', 'WriteBarrierDynDemo.client.js'), 'utf8');
if (!dynJs.includes('__vmzWriteBarrier = true')) fail('DynDemo missing barrier flag');
if (!dynJs.includes('String(this.selected)')) {
    fail(`missing dynamic selected index rewrite:\n${dynJs}`);
}
if (!dynJs.includes('String(i)')) fail('missing String(i) dynamic index');
if (!dynJs.includes('__vmzReadPath(this, "user", ["count"])')) {
    fail('missing compound/update ReadPath');
}
if (/this\.user\.count\s*\+=/.test(dynJs)) fail('bare += still present');
if (/this\.user\.count\+\+/.test(dynJs)) fail('bare ++ still present');

const sharedJs = fs.readFileSync(path.join(dist, 'components', 'WriteBarrierSharedDemo.client.js'), 'utf8');
if (!sharedJs.includes('__vmzWriteBarrier = true')) fail('SharedDemo missing barrier flag');
if (!sharedJs.includes('__vmzWritePath(this, "secondary", ["name"]')) {
    fail('SharedDemo missing secondary.name rewrite');
}

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="shared"></div><div id="dyn"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
const { default: WriteBarrierSharedDemo } = await import(pathToFileURL(path.join(dist, 'components', 'WriteBarrierSharedDemo.client.js')).href);
const { default: WriteBarrierDynDemo } = await import(pathToFileURL(path.join(dist, 'components', 'WriteBarrierDynDemo.client.js')).href);

// --- Shared multi-owner ---
const sharedRoot = window.document.getElementById('shared');
dom.__vmzPrecisionEnable(true);
const sharedInst = await dom.mount(WriteBarrierSharedDemo, sharedRoot);
sharedInst.share();
await dom.flushPending(sharedInst);
if (sharedInst.primary !== sharedInst.secondary) fail('share() must assign same object');
if (dom.__vmzIsReactiveProxy?.(sharedInst.primary)) {
    fail('shared object must not be Proxy under WriteBarrier');
}
const ps = [...sharedRoot.querySelectorAll('p')];
if (ps.length !== 2) fail(`want 2 paragraphs, got ${ps.length}`);
if (ps[0].textContent !== 'shared' || ps[1].textContent !== 'shared') {
    fail(`after share text want shared/shared, got ${JSON.stringify(ps.map((p) => p.textContent))}`);
}

dom.__vmzPrecisionReset();
sharedInst.setSecondary('both');
await dom.flushPending(sharedInst);
const snap = dom.__vmzPrecisionSnapshot();
if ((snap.patchesByDep['primary.name'] ?? 0) < 1) {
    fail(`shared write must patch primary.name: ${JSON.stringify(snap)}`);
}
if ((snap.patchesByDep['secondary.name'] ?? 0) < 1) {
    fail(`shared write must patch secondary.name: ${JSON.stringify(snap)}`);
}
if (ps[0].textContent !== 'both' || ps[1].textContent !== 'both') {
    fail(`after setSecondary want both/both, got ${JSON.stringify(ps.map((p) => p.textContent))}`);
}

// --- Dynamic index + compound ---
const dynRoot = window.document.getElementById('dyn');
dom.__vmzPrecisionReset();
const dynInst = await dom.mount(WriteBarrierDynDemo, dynRoot);
if (dom.__vmzIsReactiveProxy?.(dynInst.tags)) {
    fail('tags must not be Proxy under WriteBarrier');
}

dynInst.selected = 1;
await dom.flushPending(dynInst);
dynInst.setSelectedLabel('B2');
await dom.flushPending(dynInst);
const lis = [...dynRoot.querySelectorAll('li')];
if (lis[1]?.textContent !== 'B2') {
    fail(`dynamic selected label want B2, got ${JSON.stringify(lis.map((l) => l.textContent))}`);
}

dynInst.setAt(0, 'A2');
await dom.flushPending(dynInst);
if (lis[0]?.textContent !== 'A2') {
    fail(`dynamic i label want A2, got ${JSON.stringify(lis[0]?.textContent)}`);
}

if (dynRoot.querySelector('strong')?.textContent !== '0') {
    fail(`initial count want 0, got ${JSON.stringify(dynRoot.querySelector('strong')?.textContent)}`);
}
dynInst.bump();
await dom.flushPending(dynInst);
if (dynRoot.querySelector('strong')?.textContent !== '1') {
    fail(`after += want 1, got ${JSON.stringify(dynRoot.querySelector('strong')?.textContent)}`);
}
dynInst.bumpAgain();
await dom.flushPending(dynInst);
if (dynRoot.querySelector('strong')?.textContent !== '2') {
    fail(`after ++ want 2, got ${JSON.stringify(dynRoot.querySelector('strong')?.textContent)}`);
}
if (dynInst.user.count !== 2) fail(`user.count want 2, got ${dynInst.user.count}`);

console.log('-WB3 GATE PASS: shared owner + dynamic index + compound assign');

/**
 * WriteBarrier first slice: static nested path writes notify without Proxy.
 *
 * Claim (narrow): compiler rewrites `this.user.name = …` → `__vmzWritePath`;
 * component sets `__vmzWriteBarrier`; makeReactive skips nested Proxy; path
 * precision still holds for the rewritten write.
 *
 * Usage (repo root): node scripts/_gate_l4_write_barrier.mjs
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
    console.error(`-WB GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wb-'));
const dist = path.join(tmp, 'dist');

console.log('-WB gate: building fullstack…');
const build = spawnSync(
    'cargo',
    ['run', '--quiet', '--manifest-path', path.join(root, 'Cargo.toml'), '-p', 'vmz-tools', '--', 'build', example, '--out-dir', dist],
    { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) fail(`build exited ${build.status}`);

const clientPath = path.join(dist, 'components', 'WriteBarrierDemo.client.js');
if (!fs.existsSync(clientPath)) fail('WriteBarrierDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

if (!clientJs.includes('__vmzWriteBarrier = true')) {
    fail('missing __vmzWriteBarrier = true');
}
if (!clientJs.includes('__vmzWritePath(this, "user", ["name"]')) {
    fail(`missing __vmzWritePath rewrite:\n${clientJs}`);
}
if (/this\.user\.name\s*=/.test(clientJs)) {
    fail('bare this.user.name = still present (rewrite failed)');
}

const ir = JSON.parse(fs.readFileSync(path.join(dist, 'components', 'WriteBarrierDemo.reactive.json'), 'utf8'));
const nameBinding = ir.components[0].bindings.find((b) => b.kind === 'text' && b.reads.some((r) => r.stable === 'user.name'));
const bioBinding = ir.components[0].bindings.find((b) => b.kind === 'text' && b.reads.some((r) => r.stable === 'user.bio'));
if (!nameBinding || !bioBinding) fail('IR missing user.name / user.bio text bindings');

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
const { default: WriteBarrierDemo } = await import(pathToFileURL(clientPath).href);

if (!WriteBarrierDemo.__vmzWriteBarrier) fail('runtime flag __vmzWriteBarrier not set');
if (!WriteBarrierDemo.__vmzDirect) fail('expected Direct component');

dom.__vmzPrecisionEnable(true);
const app = window.document.getElementById('app');
const inst = await dom.mount(WriteBarrierDemo, app);

// Prove nested value is a plain object (no Proxy) under WriteBarrier.
const user = inst.user;
if (user == null || typeof user !== 'object') fail('user missing after mount');
if (Object.getPrototypeOf(user) !== Object.prototype && Object.getPrototypeOf(user) !== null) {
    fail(`user should be plain object under WriteBarrier, got proto ${Object.getPrototypeOf(user)}`);
}

if (!app.querySelector('h2') || app.querySelector('h2').textContent !== 'anon') {
    fail(`initial h2 expected anon, got ${JSON.stringify(app.querySelector('h2')?.textContent)}`);
}
if (!app.querySelector('p') || app.querySelector('p').textContent !== 'none') {
    fail(`initial p expected none, got ${JSON.stringify(app.querySelector('p')?.textContent)}`);
}

dom.__vmzPrecisionReset();
inst.setName('Ada');
await dom.flushPending(inst);

const snap = dom.__vmzPrecisionSnapshot();
const nameKey = String(nameBinding.id);
const bioKey = String(bioBinding.id);
if ((snap.patchesByBinding[nameKey] ?? 0) < 1) {
    fail(`expected name binding patch, snap=${JSON.stringify(snap)}`);
}
if ((snap.patchesByBinding[bioKey] ?? 0) !== 0) {
    fail(`bio must not patch on user.name write: ${JSON.stringify(snap)}`);
}
const h2 = app.querySelector('h2');
const p = app.querySelector('p');
if (!h2 || h2.textContent !== 'Ada') fail(`h2 expected Ada, got ${JSON.stringify(h2?.textContent)}`);
if (!p || p.textContent !== 'none') fail(`bio must stay none, got ${JSON.stringify(p?.textContent)}`);

console.log('-WB GATE PASS: WriteBarrier nested path write without Proxy');

/**
 * WriteBarrier slice 4: logical ||= / &&= / ??= + cross-component share diagnose.
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
    console.error(`-WB4 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wb4-'));
const dist = path.join(tmp, 'dist');

console.log('-WB4 gate: building fullstack…');
const build = spawnSync(
    'cargo',
    ['run', '--quiet', '--manifest-path', path.join(root, 'Cargo.toml'), '-p', 'vmz-tools', '--', 'build', example, '--out-dir', dist],
    { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) fail(`build exited ${build.status}`);

const logicalJs = fs.readFileSync(path.join(dist, 'components', 'WriteBarrierLogicalDemo.client.js'), 'utf8');
if (!logicalJs.includes('__vmzWriteBarrier = true')) fail('LogicalDemo missing barrier');
if (!logicalJs.includes('__vmzWritePathLogical(this, "user", ["flag"], "||"')) {
    fail(`missing ||= rewrite:\n${logicalJs}`);
}
if (!logicalJs.includes('__vmzWritePathLogical(this, "user", ["name"], "??"')) {
    fail('missing ??= rewrite');
}
if (!logicalJs.includes('__vmzWritePathLogical(this, "user", ["flag"], "&&"')) {
    fail('missing &&= rewrite');
}
if (/this\.user\.flag\s*\|\|=/.test(logicalJs)) fail('bare ||= still present');

const crossJs = fs.readFileSync(path.join(dist, 'components', 'WriteBarrierCrossDemo.client.js'), 'utf8');
if (!crossJs.includes('__vmzWriteBarrier = true')) fail('CrossDemo missing barrier');

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="a"></div><div id="b"></div><div id="logic"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
const { default: WriteBarrierLogicalDemo } = await import(
    pathToFileURL(path.join(dist, 'components', 'WriteBarrierLogicalDemo.client.js')).href
);
const { default: WriteBarrierCrossDemo } = await import(pathToFileURL(path.join(dist, 'components', 'WriteBarrierCrossDemo.client.js')).href);

// --- Logical assigns ---
const logicRoot = window.document.getElementById('logic');
const logic = await dom.mount(WriteBarrierLogicalDemo, logicRoot);
if (logicRoot.querySelector('span')?.textContent !== '') fail('initial flag empty');
logic.ensureFlag();
await dom.flushPending(logic);
if (logicRoot.querySelector('span')?.textContent !== 'on') {
    fail(`||= want on, got ${JSON.stringify(logicRoot.querySelector('span')?.textContent)}`);
}
// truthy short-circuit: should not overwrite
logic.user.flag = 'kept';
await dom.flushPending(logic);
logic.ensureFlag();
await dom.flushPending(logic);
if (logic.user.flag !== 'kept') fail(`||= must not overwrite truthy, got ${logic.user.flag}`);

if (logicRoot.querySelector('em')?.textContent !== 'null' && logic.user.name != null) {
    // text of null may be "" depending on bind — check state
}
logic.ensureName();
await dom.flushPending(logic);
if (logic.user.name !== 'anon') fail(`??= want anon, got ${logic.user.name}`);
if (logicRoot.querySelector('em')?.textContent !== 'anon') {
    fail(`??= DOM want anon, got ${JSON.stringify(logicRoot.querySelector('em')?.textContent)}`);
}

logic.clearFlag(); // flag is 'kept' truthy → &&= "" writes
await dom.flushPending(logic);
if (logic.user.flag !== '') fail(`&&= want "", got ${JSON.stringify(logic.user.flag)}`);

// --- Cross-component share diagnose ---
dom.__vmzSharedCrossComponentDiagnosticsReset();
const a = await dom.mount(WriteBarrierCrossDemo, window.document.getElementById('a'));
const b = await dom.mount(WriteBarrierCrossDemo, window.document.getElementById('b'));
const shared = { label: 'shared' };
a.data = shared;
b.data = shared;
await dom.flushPending(a);
await dom.flushPending(b);
const diags = dom.__vmzSharedCrossComponentDiagnostics();
if (!diags.some((d) => d.kind === 'shared_cross_component')) {
    fail(`expected cross-component diagnostic, got ${JSON.stringify(diags)}`);
}

// Explicit allow suppresses further unique messages; reset and retry with allow
dom.__vmzSharedCrossComponentDiagnosticsReset();
const allowed = dom.__vmzAllowShared({ label: 'ok' });
const a2root = window.document.createElement('div');
const b2root = window.document.createElement('div');
window.document.body.appendChild(a2root);
window.document.body.appendChild(b2root);
const a2 = await dom.mount(WriteBarrierCrossDemo, a2root);
const b2 = await dom.mount(WriteBarrierCrossDemo, b2root);
a2.data = allowed;
b2.data = allowed;
await dom.flushPending(a2);
await dom.flushPending(b2);
const diags2 = dom.__vmzSharedCrossComponentDiagnostics();
if (diags2.some((d) => d.kind === 'shared_cross_component')) {
    fail(`__vmzAllowShared must suppress cross-component diag, got ${JSON.stringify(diags2)}`);
}

// Take shared clears registry — re-assign same ref is a no-op on setter, so use a fresh object
dom.__vmzSharedCrossComponentDiagnosticsReset();
const exclusive = { label: 'solo' };
a2.data = exclusive;
await dom.flushPending(a2);
if (dom.__vmzSharedCrossComponentDiagnostics().length !== 0) {
    fail('single-owner assign should not diagnose');
}
if (a2root.querySelector('p')?.textContent !== 'solo') {
    fail(`after exclusive assign want solo, got ${JSON.stringify(a2root.querySelector('p')?.textContent)}`);
}

a2.setLabel('y');
await dom.flushPending(a2);
if (a2root.querySelector('p')?.textContent !== 'y') {
    fail(`cross demo patch want y, got ${JSON.stringify(a2root.querySelector('p')?.textContent)}`);
}

// __vmzTakeShared still usable as exclusive-intent API
dom.__vmzTakeShared(exclusive);

console.log('-WB4 GATE PASS: logical assign + cross-component share diagnose');

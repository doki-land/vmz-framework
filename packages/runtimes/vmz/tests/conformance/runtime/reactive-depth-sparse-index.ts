/**
 * Reactive depth: a sparse index write must not break the keyed list kernel.
 *
 * `this.rows[4] = row` on a three-item array leaves holes at 1..3. The generated
 * clone kernel read `item.id` before any guard, so the first hole threw
 * `TypeError: Cannot read properties of undefined (reading 'id')`, the patch
 * aborted with `vmz:dom patch`, and the rendered rows were left partially stale.
 *
 * Holes are not rows, so the kernel now skips `item == null` before reading the
 * key or any item field.
 *
 * Usage: pnpm --filter vmz run verify -- reactive-depth-sparse-index
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { parseHTML } from 'linkedom';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'fullstack');

function fail(msg) {
    console.error(`-RDEPTH-SPARSE GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-rdepth-sparse-'));
const dist = path.join(tmp, 'dist');

console.log('-RDEPTH-SPARSE gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'ReactiveDepthDemo.client.js');
if (!fs.existsSync(clientPath)) fail('ReactiveDepthDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

if (!clientJs.includes('if (item == null) continue;')) {
    fail('rowKernel create must skip sparse holes before reading the item key');
}
if (!clientJs.includes('__vmzWritePath(this, "rows", [4]')) {
    fail(`sparse index write must stay a barrier path write:\n${clientJs}`);
}

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div><div id="hyd"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(profileDir, 'vmz-dom.js')).href);
const { default: ReactiveDepthDemo } = await import(pathToFileURL(clientPath).href);

const patchErrors = [];
const originalError = console.error;
console.error = (...args) => {
    const text = args.map((a) => (a && a.stack) || String(a)).join(' ');
    if (text.includes('vmz:dom patch')) patchErrors.push(text.split('\n')[0]);
    originalError(...args);
};

async function click(host, id, inst) {
    const btn = host.querySelector(`#${id}`);
    if (!btn) fail(`button #${id} missing`);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await dom.flushPending(inst);
}
function rows(host) {
    return [...host.querySelectorAll('#rows li')].map((li) => li.textContent);
}
function assertGrown(host, stage) {
    const texts = rows(host);
    if (texts.join(',') !== 'R1,R2,R3,R9') {
        fail(`${stage}: sparse rows want R1,R2,R3,R9, got ${JSON.stringify(texts)}`);
    }
    if (patchErrors.length) fail(`${stage}: patch errors ${JSON.stringify(patchErrors)}`);
}

// --- Mount path ---
const app = window.document.getElementById('app');
const inst = await dom.mount(ReactiveDepthDemo, app);
await click(app, 'root-grow', inst);
assertGrown(app, 'mount');

// --- Hydrate path ---
const hyd = window.document.getElementById('hyd');
hyd.innerHTML = await dom.renderToString(ReactiveDepthDemo, { props: {} });
const hydInst = await dom.hydrate(ReactiveDepthDemo, hyd);
await click(hyd, 'root-grow', hydInst);
assertGrown(hyd, 'hydrate');

console.error = originalError;
console.log('-RDEPTH-SPARSE GATE PASS: sparse index write renders existing rows without a patch error');

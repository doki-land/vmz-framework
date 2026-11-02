/**
 * WriteBarrier mutator-args + dynamic-path slice.
 *
 * Claim (narrow):
 * - `this.cells.splice(i, 0, cell)` lowers to `__vmzArrayMutate` with the argument
 *   list as one array literal, so the runtime actually receives the elements.
 * - `this.cells[0] = …` keeps the computed index as a live expression.
 * - `this.meta.note.count++` (two static segments on an object root) stays on the
 *   generic path and still notifies.
 * - Mount and SSR-hydrate both repaint after the first event; a handler calling
 *   another method runs the full chain.
 * - Runtime rejects a stale non-array `args` with a structured error.
 *
 * Usage: pnpm --filter vmz run verify -- write-barrier-mutator-args
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
    console.error(`-WBA GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wba-'));
const dist = path.join(tmp, 'dist');

console.log('-WBA gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

// Default delivery profile nests artifacts under `web-ssr/`.
const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'WriteBarrierMutatorDemo.client.js');
if (!fs.existsSync(clientPath)) fail('WriteBarrierMutatorDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

if (!clientJs.includes('__vmzArrayMutate(this, "cells", [], "splice", [1, 0, cell])')) {
    fail(`splice args must emit as one array literal:\n${clientJs}`);
}
if (!clientJs.includes('__vmzArrayMutate(this, "cells", [], "push", [')) {
    fail(`push arg must emit as one array literal:\n${clientJs}`);
}
if (!clientJs.includes('__vmzWritePath(this, "cells", [0],')) {
    fail(`computed root index must stay a live expression:\n${clientJs}`);
}
if (clientJs.includes('["0"]')) fail('computed index frozen into a string literal');
if (!clientJs.includes('__vmzWritePathCompound(this, "meta", ["note", "count"], "+", 1)')) {
    fail(`two-segment object update must stay on the generic path:\n${clientJs}`);
}
if (clientJs.includes('__vmzWritePathCompoundItem(this, "meta"')) {
    fail('object root must not lower to the array item helper');
}

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div><div id="hyd"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(profileDir, 'vmz-dom.js')).href);
const { default: WriteBarrierMutatorDemo } = await import(pathToFileURL(clientPath).href);

function liTexts(host) {
    return [...host.querySelectorAll('li')].map((li) => li.textContent);
}
async function click(host, id, inst) {
    const btn = host.querySelector(`#${id}`);
    if (!btn) fail(`button #${id} missing`);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await dom.flushPending(inst);
}

// --- Mount path: handler → method → splice/patch chain ---
const app = window.document.getElementById('app');
const inst = await dom.mount(WriteBarrierMutatorDemo, app);
if (liTexts(app).join(',') !== 'A,B') fail(`initial list want A,B got ${liTexts(app)}`);

await click(app, 'insert', inst);
if (liTexts(app).join(',') !== 'A,X,B') fail(`after insert want A,X,B got ${liTexts(app)}`);
if (app.querySelector('strong')?.textContent !== '3') fail('count must repaint to 3 after splice');

await click(app, 'push', inst);
if (liTexts(app).join(',') !== 'A,X,B,P') fail(`after push want A,X,B,P got ${liTexts(app)}`);

await click(app, 'patch', inst);
if (liTexts(app)[0] !== 'A2') fail(`after patch want first li A2 got ${liTexts(app)}`);

await click(app, 'count', inst);
if (app.querySelector('em')?.textContent !== '1') fail('object nested ++ must repaint em to 1');

// --- Hydrate path: first event after hydrate must work ---
const hyd = window.document.getElementById('hyd');
const html = await dom.renderToString(WriteBarrierMutatorDemo, { props: {} });
hyd.innerHTML = html;
const hydInst = await dom.hydrate(WriteBarrierMutatorDemo, hyd);
if (liTexts(hyd).join(',') !== 'A,B') fail(`hydrate initial want A,B got ${liTexts(hyd)}`);
await click(hyd, 'insert', hydInst);
if (liTexts(hyd).join(',') !== 'A,X,B') {
    fail(`first event after hydrate want A,X,B got ${liTexts(hyd)}`);
}

// --- Runtime contract: stale bare-args emit is rejected ---
let threw = false;
try {
    inst.constructor.__vmzArrayMutate(inst, 'cells', [], 'splice', 1);
} catch (err) {
    threw = err instanceof Error && /argument list as one array/.test(err.message);
}
if (!threw) fail('non-array mutator args must throw a structured error');
if (inst.cells.length !== 4) fail(`rejected mutate must not change state, length=${inst.cells.length}`);

console.log('-WBA GATE PASS: mutator args + dynamic path + hydrate first event');

/**
 * WriteBarrier slice 2: alias path writes + array mutator / static index.
 *
 * Claim (narrow): under `__vmzWriteBarrier`, nested values stay plain (no Proxy);
 * `const u = this.user; u.name = …` and `this.tags.push` / `this.tags[0].label =`
 * notify via compiler barriers with path precision.
 *
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { parseHTML } from 'linkedom';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'fullstack');

function fail(msg) {
    console.error(`-WB2 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wb2-'));
const dist = path.join(tmp, 'dist');

console.log('-WB2 gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

// --- Alias rewrite on WriteBarrierDemo ---
const demoJs = fs.readFileSync(path.join(dist, 'components', 'WriteBarrierDemo.client.js'), 'utf8');
if (!demoJs.includes('__vmzWriteBarrier = true')) fail('WriteBarrierDemo missing barrier flag');
if (!demoJs.includes('__vmzWritePath(this, "user", ["name"]')) {
    fail('WriteBarrierDemo missing path rewrite');
}
if (/u\.name\s*=/.test(demoJs)) fail('alias u.name = still present');

// --- Array rewrite on WriteBarrierArrayDemo ---
const arrPath = path.join(dist, 'components', 'WriteBarrierArrayDemo.client.js');
if (!fs.existsSync(arrPath)) fail('WriteBarrierArrayDemo.client.js missing');
const arrJs = fs.readFileSync(arrPath, 'utf8');
if (!arrJs.includes('__vmzWriteBarrier = true')) fail('ArrayDemo missing barrier flag');
if (!arrJs.includes('__vmzArrayMutate(this, "tags", [], "push"')) {
    fail(`missing array mutate rewrite:\n${arrJs}`);
}
if (/this\.tags\.push\(/.test(arrJs)) fail('bare this.tags.push still present');
if (/t\.push\(/.test(arrJs)) fail('bare alias t.push still present');
if (!arrJs.includes('__vmzWritePath(this, "tags", ["0", "label"]')) {
    fail(`missing static index leaf rewrite:\n${arrJs}`);
}
if (/this\.tags\[0\]\.label\s*=/.test(arrJs)) fail('bare tags[0].label = still present');

const ir = JSON.parse(fs.readFileSync(path.join(dist, 'components', 'WriteBarrierArrayDemo.reactive.json'), 'utf8'));
const labelBinding = ir.components[0].bindings.find(
    (b) =>
        b.kind === 'text' &&
        b.reads.some(
            (r) =>
                typeof r.stable === 'string' && (r.stable === 'tags.*.label' || (r.stable.endsWith('.label') && r.stable.startsWith('tags['))),
        ),
);
if (!labelBinding) {
    fail(`missing tags item label binding: ${JSON.stringify(ir.components[0].bindings, null, 2)}`);
}

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div><div id="arr"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
const { default: WriteBarrierDemo } = await import(pathToFileURL(path.join(dist, 'components', 'WriteBarrierDemo.client.js')).href);
const { default: WriteBarrierArrayDemo } = await import(pathToFileURL(arrPath).href);

if (typeof WriteBarrierDemo.__vmzWritePath !== 'function') {
    // installed on mount
}

// Alias runtime
const app = window.document.getElementById('app');
dom.__vmzPrecisionEnable(true);
const demo = await dom.mount(WriteBarrierDemo, app);
if (dom.__vmzIsReactiveProxy?.(demo.user)) {
    fail('demo.user must not be a reactive Proxy under WriteBarrier');
}
dom.__vmzPrecisionReset();
demo.setViaAlias('Ada');
await dom.flushPending(demo);
if (app.querySelector('h2')?.textContent !== 'Ada') {
    fail(`alias write h2 want Ada, got ${JSON.stringify(app.querySelector('h2')?.textContent)}`);
}
if (app.querySelector('p')?.textContent !== 'none') fail('alias write must not touch bio');

// Array runtime — plain array, mutator + index leaf
const arrRoot = window.document.getElementById('arr');
dom.__vmzPrecisionReset();
const arrInst = await dom.mount(WriteBarrierArrayDemo, arrRoot);
if (!Array.isArray(arrInst.tags)) fail('tags not array');
if (dom.__vmzIsReactiveProxy?.(arrInst.tags)) {
    fail('tags must not be a reactive Proxy under WriteBarrier');
}
if (arrRoot.querySelectorAll('li').length !== 2) {
    fail(`initial li count want 2, got ${arrRoot.querySelectorAll('li').length}`);
}

arrInst.addTag({ id: 'c', label: 'C' });
await dom.flushPending(arrInst);
if (arrInst.tags.length !== 3) fail(`after push length want 3, got ${arrInst.tags.length}`);
if (arrRoot.querySelectorAll('li').length !== 3) {
    fail(`after push li want 3, got ${arrRoot.querySelectorAll('li').length}`);
}
if (![...arrRoot.querySelectorAll('li')].some((li) => li.textContent === 'C')) {
    fail(`DOM missing C after push: ${arrRoot.textContent}`);
}

arrInst.addViaAlias({ id: 'd', label: 'D' });
await dom.flushPending(arrInst);
if (arrInst.tags.length !== 4) fail(`after alias push length want 4, got ${arrInst.tags.length}`);
if (arrRoot.querySelectorAll('li').length !== 4) {
    fail(`after alias push li want 4, got ${arrRoot.querySelectorAll('li').length}`);
}

dom.__vmzPrecisionReset();
arrInst.setFirstLabel('A2');
await dom.flushPending(arrInst);
const snap = dom.__vmzPrecisionSnapshot();
const labelKey = String(labelBinding.id);
if ((snap.patchesByBinding[labelKey] ?? 0) < 1) {
    fail(`expected item label patch, snap=${JSON.stringify(snap)}`);
}
const first = arrRoot.querySelector('li');
if (!first || first.textContent !== 'A2') {
    fail(`first li want A2, got ${JSON.stringify(first?.textContent)} full=${arrRoot.textContent}`);
}

console.log('-WB2 GATE PASS: alias + array WriteBarrier without Proxy');

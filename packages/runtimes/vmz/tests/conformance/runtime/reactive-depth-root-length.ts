/**
 * Reactive depth: root array `length` assignment is a structure write.
 *
 * Claim (narrow): `this.rows.length = 1` must repaint the rendered rows, not just
 * the `rows.length` text. The bare `rows` structure depot only wakes on a replace
 * notice, so the runtime has to treat a root-level `length` write as structure.
 *
 * Before the fix, the list text showed `1` while the `<li>` rows stayed stale.
 * Mount and SSR-hydrate paths must both repaint after the first event.
 *
 * Usage: pnpm --filter vmz run verify -- reactive-depth-root-length
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
    console.error(`-RDEPTH-LEN GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-rdepth-len-'));
const dist = path.join(tmp, 'dist');

console.log('-RDEPTH-LEN gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'ReactiveDepthDemo.client.js');
if (!fs.existsSync(clientPath)) fail('ReactiveDepthDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

if (!clientJs.includes('__vmzWriteBarrier = true')) fail('ReactiveDepthDemo missing barrier flag');
if (!clientJs.includes('__vmzWritePath(this, "rows", ["length"], 1)')) {
    fail(`root length write must stay a barrier path write:\n${clientJs}`);
}
if (/this\.rows\.length\s*=\s*1/.test(clientJs)) fail('bare this.rows.length = 1 still present');

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div><div id="hyd"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(profileDir, 'vmz-dom.js')).href);
const { default: ReactiveDepthDemo } = await import(pathToFileURL(clientPath).href);

function rowTexts(host) {
    return [...host.querySelectorAll('#rows li')].map((li) => li.textContent);
}
async function click(host, id, inst) {
    const btn = host.querySelector(`#${id}`);
    if (!btn) fail(`button #${id} missing`);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await dom.flushPending(inst);
}
function assertTruncated(host, stage) {
    const texts = rowTexts(host);
    if (texts.join(',') !== 'R1') fail(`${stage}: rows want R1 after length=1, got ${JSON.stringify(texts)}`);
    const len = host.querySelector('#root-len')?.textContent;
    if (len !== '1') fail(`${stage}: root-len text want 1, got ${JSON.stringify(len)}`);
}

// --- Mount path ---
const app = window.document.getElementById('app');
const inst = await dom.mount(ReactiveDepthDemo, app);
if (rowTexts(app).join(',') !== 'R1,R2,R3') fail(`mount initial rows want R1,R2,R3 got ${rowTexts(app)}`);
await click(app, 'root-length', inst);
assertTruncated(app, 'mount');

// --- Hydrate path: first event after hydrate must repaint ---
const hyd = window.document.getElementById('hyd');
const html = await dom.renderToString(ReactiveDepthDemo, { props: {} });
hyd.innerHTML = html;
const hydInst = await dom.hydrate(ReactiveDepthDemo, hyd);
if (rowTexts(hyd).join(',') !== 'R1,R2,R3') fail(`hydrate initial rows want R1,R2,R3 got ${rowTexts(hyd)}`);
await click(hyd, 'root-length', hydInst);
assertTruncated(hyd, 'hydrate');

console.log('-RDEPTH-LEN GATE PASS: root array length write repaints rows');

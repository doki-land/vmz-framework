/**
 * Reactive depth: nested writes that run inside callbacks and statement
 * containers must still go through the write barrier.
 *
 * A WriteBarrier component keeps plain state objects, so only the compiled
 * `__vmzWritePath` call reports a nested write. The collector used to walk just
 * declarations, blocks, classes, functions, `if` and `for`, which meant
 * `this.board.meta.note.count = 5` inside `.then`, `setTimeout`, `for…of`,
 * `switch`, `try` or `while` stayed a bare assignment and never repainted.
 *
 * Before the fix, the promise/timer/loop clicks left the count at its old value;
 * after the fix every path repaints on mount and after SSR hydrate.
 *
 * Usage: pnpm --filter vmz run verify -- reactive-depth-nested-writes
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
    console.error(`-RDEPTH-NESTED GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-rdepth-nested-'));
const dist = path.join(tmp, 'dist');

console.log('-RDEPTH-NESTED gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'ReactiveDepthDemo.client.js');
if (!fs.existsSync(clientPath)) fail('ReactiveDepthDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

const expected = [
    ['promise', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 9)'],
    ['timer', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 5)'],
    ['for-of', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], tag.label.length)'],
    ['switch case', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 3)'],
    ['switch default', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 4)'],
    ['try', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 6)'],
    ['catch', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 8)'],
    ['while', 'this.constructor.__vmzWritePath(this, "board", ["meta", "note", "count"], 2)'],
];
for (const [where, code] of expected) {
    if (!clientJs.includes(code)) fail(`${where}: missing rewrite ${code}`);
}
if (/this\.board\.meta\.note\.count\s*=/.test(clientJs)) {
    fail('bare nested assignment inside a callback or statement container survived the barrier');
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function click(host, id, inst, async = false) {
    const btn = host.querySelector(`#${id}`);
    if (!btn) fail(`button #${id} missing`);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await dom.flushPending(inst);
    if (async) {
        await settle();
        await dom.flushPending(inst);
    }
}

function count(host) {
    return host.querySelector('em')?.textContent;
}

function want(host, value, stage) {
    const got = count(host);
    if (got !== String(value)) fail(`${stage}: nested count want ${value}, got ${JSON.stringify(got)}`);
}

// --- Mount path ---
const app = window.document.getElementById('app');
const inst = await dom.mount(ReactiveDepthDemo, app);
want(app, 1, 'mount initial');
await click(app, 'later-promise', inst, true);
want(app, 9, 'mount promise');
await click(app, 'later-timeout', inst, true);
want(app, 5, 'mount timer');
await click(app, 'loop-write', inst);
want(app, 1, 'mount for-of');
await click(app, 'switch-write', inst);
want(app, 3, 'mount switch');
await click(app, 'try-write', inst);
want(app, 6, 'mount try');
await click(app, 'while-write', inst);
want(app, 2, 'mount while');

// --- Hydrate path: the callback runs after the first event ---
const hyd = window.document.getElementById('hyd');
hyd.innerHTML = await dom.renderToString(ReactiveDepthDemo, { props: {} });
const hydInst = await dom.hydrate(ReactiveDepthDemo, hyd);
want(hyd, 1, 'hydrate initial');
await click(hyd, 'later-promise', hydInst, true);
want(hyd, 9, 'hydrate promise');
await click(hyd, 'loop-write', hydInst);
want(hyd, 1, 'hydrate for-of');

console.log('-RDEPTH-NESTED GATE PASS: callback and container writes repaint');

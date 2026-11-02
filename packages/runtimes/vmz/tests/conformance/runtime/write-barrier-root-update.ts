/**
 * WriteBarrier root-field update slice: `this.count++` / `++this.count` / `--this.count`.
 *
 * Claim (narrow):
 * - Compiler never emits `__vmzWritePath*` with an empty path for root field updates
 *   (root writes stay plain JS and flow through the reactive field setter).
 * - Nested updates (`this.user.count++`) still lower to `__vmzWritePathCompound`.
 * - Template inline handlers (`@click="count++"`) update state and repaint.
 * - Runtime rejects an empty-segment write path with a structured error (no silent drop).
 *
 * Usage: pnpm --filter vmz run verify -- write-barrier-root-update
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
    console.error(`-WBR GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l4wbr-'));
const dist = path.join(tmp, 'dist');

console.log('-WBR gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

// Default delivery profile nests artifacts under `web-ssr/`.
const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'WriteBarrierRootUpdateDemo.client.js');
if (!fs.existsSync(clientPath)) fail('WriteBarrierRootUpdateDemo.client.js missing');
const clientJs = fs.readFileSync(clientPath, 'utf8');

// Compile-time contract: root field updates must not become empty-path writes.
const emptyPath = /__vmzWritePath(?:Compound|Logical)?\(this, "[^"]+", \[\]/;
if (emptyPath.test(clientJs)) {
    fail(`empty-segment write path emitted for root field:\n${clientJs}`);
}
if (!clientJs.includes('this.count++')) fail('postfix `this.count++` must stay plain JS');
if (!clientJs.includes('++this.count')) fail('prefix `++this.count` must stay plain JS');
if (!clientJs.includes('this.count--')) fail('postfix `this.count--` must stay plain JS');
if (!clientJs.includes('--this.count')) fail('prefix `--this.count` must stay plain JS');
if (!clientJs.includes('__vmzWritePathCompound(this, "user", ["count"], "+", 1)')) {
    fail(`nested update must still lower to __vmzWritePathCompound:\n${clientJs}`);
}
if (/this\.user\.count\+\+/.test(clientJs)) fail('bare nested ++ still present');

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;

const dom = await import(pathToFileURL(path.join(profileDir, 'vmz-dom.js')).href);
const { default: WriteBarrierRootUpdateDemo } = await import(pathToFileURL(clientPath).href);

const app = window.document.getElementById('app');
const inst = await dom.mount(WriteBarrierRootUpdateDemo, app);

const strong = () => app.querySelector('strong')?.textContent;
const em = () => app.querySelector('em')?.textContent;

if (strong() !== '0') fail(`initial count want 0, got ${JSON.stringify(strong())}`);

inst.bumpPost();
await dom.flushPending(inst);
if (strong() !== '1') fail(`after this.count++ want 1, got ${JSON.stringify(strong())}`);

inst.bumpPre();
await dom.flushPending(inst);
if (strong() !== '2') fail(`after ++this.count want 2, got ${JSON.stringify(strong())}`);

inst.dropPost();
await dom.flushPending(inst);
if (strong() !== '1') fail(`after this.count-- want 1, got ${JSON.stringify(strong())}`);

inst.dropPre();
await dom.flushPending(inst);
if (strong() !== '0') fail(`after --this.count want 0, got ${JSON.stringify(strong())}`);

// Template inline handler: `@click="count++"` must update state and repaint.
const inlineBtn = app.querySelector('#inline');
if (!inlineBtn) fail('inline handler button missing');
inlineBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
await dom.flushPending(inst);
if (strong() !== '1') fail(`after @click="count++" want 1, got ${JSON.stringify(strong())}`);
if (inst.count !== 1) fail(`instance count want 1, got ${inst.count}`);

// Nested update still flows through the write barrier.
inst.bumpNested();
await dom.flushPending(inst);
if (em() !== '1') fail(`after nested ++ want em=1, got ${JSON.stringify(em())}`);

// Runtime contract: an empty-segment write path is a structured failure.
let threw = 0;
for (const call of [
    () => inst.constructor.__vmzWritePathCompound(inst, 'count', [], '+', 1),
    () => inst.constructor.__vmzWritePath(inst, 'user', [], { count: 9 }),
    () => inst.constructor.__vmzWritePathLogical(inst, 'count', [], '||', 1),
]) {
    try {
        call();
    } catch (err) {
        if (err instanceof Error && /non-empty path/.test(err.message)) threw++;
    }
}
if (threw !== 3) fail(`empty-segment writes must throw (got ${threw}/3 structured failures)`);
if (inst.count !== 1) fail(`rejected writes must not mutate state, count=${inst.count}`);

console.log('-WBR GATE PASS: root-field ++/-- flow through setter, empty path rejected');

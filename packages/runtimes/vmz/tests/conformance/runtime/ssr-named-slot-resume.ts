/**
 * Named slot projections must be reclaimed during resume exactly like the
 * default outlet.
 *
 * Direct SSR flattens every `<slot>` outlet, named ones included, so the page
 * HTML carries the projected nodes in place and no outlet anchor. Resume scopes
 * adoption to the default outlet pool, which leaves the nodes projected into a
 * `<slot name="…">` outside every searched pool and rebuilds them on every load.
 * This gate builds the `named-slots` fixture for real, hydrates it and asserts
 * that the named projection keeps the exact SSR element and text nodes, that
 * the nodes stay inside their named outlet, and that a later state update
 * patches the same nodes instead of replacing them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'named-slots');
const dist = path.join(example, 'dist', 'web-ssr');

function fail(msg: string): never {
    console.error(`ssr-named-slot-resume GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ssr-named-slot-resume: vmz build named-slots…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);
for (const rel of ['vmz-dom.js', 'pages/index.client.js']) {
    if (!fs.existsSync(path.join(dist, ...rel.split('/')))) fail(`missing ${path.join(dist, rel)}`);
}

const domHref = pathToFileURL(path.join(dist, 'vmz-dom.js')).href;
const pageHref = pathToFileURL(path.join(dist, 'pages', 'index.client.js')).href;
const { renderToString, hydrate, flushPending } = await import(domHref);
const { default: IndexPage } = await import(pageHref);

const pageHtml = await renderToString(IndexPage, { props: {} });
if (!pageHtml.includes('id="named-title"')) fail(`SSR page missing the named projection: ${pageHtml}`);
if (/<slot[\s/>]/.test(pageHtml)) fail('SSR still serializes a <slot> outlet instead of inlining it');

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${pageHtml}</div></body></html>`);
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;

const app = window.document.getElementById('app');
const ssrTitle = app.querySelector('#named-title');
const ssrSubtitle = app.querySelector('#named-subtitle');
const ssrCopy = app.querySelector('#named-copy');
const ssrFoot = app.querySelector('#named-foot');
if (!ssrTitle || !ssrSubtitle || !ssrCopy || !ssrFoot) fail('SSR projection nodes are missing before hydrate');
const ssrTitleText = ssrTitle.firstChild;

const inst = await hydrate(IndexPage, app, {});

function expectSame(selector: string, before: any, label: string): any {
    const after = app.querySelector(selector);
    if (!after) fail(`${label}: ${selector} disappeared`);
    if (after !== before) fail(`${label}: ${selector} was rebuilt instead of reclaimed`);
    return after;
}

const title = expectSame('#named-title', ssrTitle, 'hydrate');
const subtitle = expectSame('#named-subtitle', ssrSubtitle, 'hydrate');
const copy = expectSame('#named-copy', ssrCopy, 'hydrate');
expectSame('#named-foot', ssrFoot, 'hydrate');

if (title.closest('#named-header') == null) fail('named projection left its named outlet');
if (copy.closest('#named-body') == null) fail('default projection left the default outlet');
if (title.firstChild !== ssrTitleText) fail('hydrate rebuilt the named projection text node');
if (!String(subtitle.textContent).includes('Header subtitle')) fail('named projection lost its text');

inst.title = 'Header updated';
await flushPending(inst);

const updated = app.querySelector('#named-title');
if (updated !== title) fail('state update rebuilt the named projection node');
if (!String(updated.textContent).includes('Header updated')) fail('state update did not patch the named projection');

console.log('ssr-named-slot-resume GATE PASS: named projection keeps its SSR nodes through hydrate')

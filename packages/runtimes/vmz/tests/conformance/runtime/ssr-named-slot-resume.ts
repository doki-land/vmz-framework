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
const rowsHref = pathToFileURL(path.join(dist, 'pages', 'rows.client.js')).href;
const dynamicHref = pathToFileURL(path.join(dist, 'pages', 'dynamic.client.js')).href;
const loopHref = pathToFileURL(path.join(dist, 'pages', 'loop.client.js')).href;
const nestedHref = pathToFileURL(path.join(dist, 'pages', 'nested.client.js')).href;
const { renderToString, hydrate, flushPending } = await import(domHref);
const { default: IndexPage } = await import(pageHref);
const { default: RowsPage } = await import(rowsHref);
const { default: DynamicPage } = await import(dynamicHref);
const { default: LoopPage } = await import(loopHref);
const { default: NestedPage } = await import(nestedHref);

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

// 2. Named projections inside keyed component rows: the row host is claimed by
// key, so its named outlet pool must follow the host instead of the DOM order.
const rowsHtml = await renderToString(RowsPage, { props: {} });
if (!rowsHtml.includes('row-title')) fail(`SSR rows page missing the named projection: ${rowsHtml}`);
if (!rowsHtml.includes('vmz-row:')) fail('keyed component rows lost their row marker in SSR');

const { window: rowsWindow } = parseHTML(
    `<!DOCTYPE html><html><body><div id="app">${rowsHtml}</div></body></html>`,
);
globalThis.window = rowsWindow;
globalThis.document = rowsWindow.document;
globalThis.HTMLElement = rowsWindow.HTMLElement;
globalThis.Node = rowsWindow.Node;
globalThis.DocumentFragment = rowsWindow.DocumentFragment;
globalThis.Text = rowsWindow.Text;
globalThis.Comment = rowsWindow.Comment;

const rowsApp = rowsWindow.document.getElementById('app');
const ssrTitles = [...rowsApp.querySelectorAll('.row-title')];
const ssrBodies = [...rowsApp.querySelectorAll('.row-body')];
if (ssrTitles.length !== 2 || ssrBodies.length !== 2) fail('rows page SSR shape is wrong');

const rowsInst = await hydrate(RowsPage, rowsApp, {});
const hydratedTitles = [...rowsApp.querySelectorAll('.row-title')];
const hydratedBodies = [...rowsApp.querySelectorAll('.row-body')];
for (const el of hydratedTitles) {
    if (!ssrTitles.includes(el)) fail(`keyed row named projection was rebuilt: ${String(el.textContent)}`);
    if (el.closest('#named-header') == null) fail('keyed row named projection left its outlet');
}
for (const el of hydratedBodies) {
    if (!ssrBodies.includes(el)) fail(`keyed row default projection was rebuilt: ${String(el.textContent)}`);
}
if (hydratedTitles[0] !== ssrTitles[0] || hydratedTitles[1] !== ssrTitles[1]) {
    fail('keyed rows did not keep their SSR order on hydrate');
}

rowsInst.panels = [rowsInst.panels[1], rowsInst.panels[0]];
await flushPending(rowsInst);
const reorderedTitles = [...rowsApp.querySelectorAll('.row-title')];
const reorderedBodies = [...rowsApp.querySelectorAll('.row-body')];
if (reorderedTitles[0] !== ssrTitles[1] || reorderedTitles[1] !== ssrTitles[0]) {
    fail('reorder did not move the original named projection nodes');
}
if (reorderedBodies[0] !== ssrBodies[1] || reorderedBodies[1] !== ssrBodies[0]) {
    fail('reorder did not move the original default projection nodes');
}

// 3. Dynamic `#[expr]` names resolve at runtime and must reach the same named
// outlet pool as the static form.
const dynamicHtml = await renderToString(DynamicPage, { props: {} });
if (!dynamicHtml.includes('dynamic-title')) fail(`SSR dynamic page missing the named projection: ${dynamicHtml}`);

const { window: dynamicWindow } = parseHTML(
    `<!DOCTYPE html><html><body><div id="app">${dynamicHtml}</div></body></html>`,
);
globalThis.window = dynamicWindow;
globalThis.document = dynamicWindow.document;
globalThis.HTMLElement = dynamicWindow.HTMLElement;
globalThis.Node = dynamicWindow.Node;
globalThis.DocumentFragment = dynamicWindow.DocumentFragment;
globalThis.Text = dynamicWindow.Text;
globalThis.Comment = dynamicWindow.Comment;

const dynamicApp = dynamicWindow.document.getElementById('app');
const ssrDynamicTitle = dynamicApp.querySelector('#dynamic-title');
if (!ssrDynamicTitle) fail('dynamic named projection is missing before hydrate');
if (ssrDynamicTitle.closest('#named-header') == null) fail('dynamic slot name did not resolve to the header outlet');

const dynamicInst = await hydrate(DynamicPage, dynamicApp, {});
const dynamicTitle = dynamicApp.querySelector('#dynamic-title');
if (dynamicTitle !== ssrDynamicTitle) fail('dynamic named projection was rebuilt instead of reclaimed');
dynamicInst.title = 'Dynamic updated';
await flushPending(dynamicInst);
if (dynamicApp.querySelector('#dynamic-title') !== dynamicTitle) {
    fail('state update rebuilt the dynamic named projection node');
}
if (!String(dynamicTitle.textContent).includes('Dynamic updated')) {
    fail('state update did not patch the dynamic named projection');
}

// 4. Keyed `v-for` rows inside a named outlet: the row scope must stay nested
// under the named outlet pool so the rows reclaim their own SSR nodes.
const loopHtml = await renderToString(LoopPage, { props: {} });
if (!loopHtml.includes('loop-chip')) fail(`SSR loop page missing the named projection: ${loopHtml}`);

const { window: loopWindow } = parseHTML(
    `<!DOCTYPE html><html><body><div id="app">${loopHtml}</div></body></html>`,
);
globalThis.window = loopWindow;
globalThis.document = loopWindow.document;
globalThis.HTMLElement = loopWindow.HTMLElement;
globalThis.Node = loopWindow.Node;
globalThis.DocumentFragment = loopWindow.DocumentFragment;
globalThis.Text = loopWindow.Text;
globalThis.Comment = loopWindow.Comment;

const loopApp = loopWindow.document.getElementById('app');
const ssrChips = [...loopApp.querySelectorAll('.loop-chip')];
if (ssrChips.length !== 2) fail(`loop page SSR shape is wrong: ${ssrChips.length} chips`);
for (const chip of ssrChips) {
    if (chip.closest('#named-header') == null) fail('looped named projection left its outlet');
}

const loopInst = await hydrate(LoopPage, loopApp, {});
const hydratedChips = [...loopApp.querySelectorAll('.loop-chip')];
for (const chip of hydratedChips) {
    if (!ssrChips.includes(chip)) fail(`keyed row inside the named outlet was rebuilt: ${String(chip.textContent)}`);
}

loopInst.chips = [loopInst.chips[1], loopInst.chips[0]];
await flushPending(loopInst);
const reorderedChips = [...loopApp.querySelectorAll('.loop-chip')];
if (reorderedChips[0] !== ssrChips[1] || reorderedChips[1] !== ssrChips[0]) {
    fail('keyed rows inside the named outlet did not move their original nodes');
}

// 5. Keyed component rows inside a named outlet whose slot content projects
// again: the outer named pool must hand the inner host its own default pool.
const nestedHtml = await renderToString(NestedPage, { props: {} });
if (!nestedHtml.includes('chip-tray')) fail(`SSR nested page missing the inner host: ${nestedHtml}`);
if (!nestedHtml.includes('nested-chip')) fail(`SSR nested page missing the inner projection: ${nestedHtml}`);

const { window: nestedWindow } = parseHTML(
    `<!DOCTYPE html><html><body><div id="app">${nestedHtml}</div></body></html>`,
);
globalThis.window = nestedWindow;
globalThis.document = nestedWindow.document;
globalThis.HTMLElement = nestedWindow.HTMLElement;
globalThis.Node = nestedWindow.Node;
globalThis.DocumentFragment = nestedWindow.DocumentFragment;
globalThis.Text = nestedWindow.Text;
globalThis.Comment = nestedWindow.Comment;

const nestedApp = nestedWindow.document.getElementById('app');
const nestedChipsBefore = [...nestedApp.querySelectorAll('.nested-chip')];
const nestedTailsBefore = [...nestedApp.querySelectorAll('.nested-tail')];
if (nestedChipsBefore.length !== 2 || nestedTailsBefore.length !== 2) fail('nested page SSR shape is wrong');

const nestedInst = await hydrate(NestedPage, nestedApp, {});
const nestedChipsAfter = [...nestedApp.querySelectorAll('.nested-chip')];
const nestedTailsAfter = [...nestedApp.querySelectorAll('.nested-tail')];
for (const chip of nestedChipsAfter) {
    if (!nestedChipsBefore.includes(chip)) fail(`nested named projection was rebuilt: ${String(chip.textContent)}`);
    if (chip.closest('#named-header') == null) fail('nested projection left the outer named outlet');
}
for (const tail of nestedTailsAfter) {
    if (!nestedTailsBefore.includes(tail)) fail(`nested projection tail was rebuilt: ${String(tail.textContent)}`);
}

nestedInst.trays = [nestedInst.trays[1], nestedInst.trays[0]];
await flushPending(nestedInst);
const nestedReorderedChips = [...nestedApp.querySelectorAll('.nested-chip')];
const nestedReorderedTails = [...nestedApp.querySelectorAll('.nested-tail')];
if (nestedReorderedChips[0] !== nestedChipsBefore[1] || nestedReorderedChips[1] !== nestedChipsBefore[0]) {
    fail('nested keyed rows did not move their original chip nodes');
}
if (nestedReorderedTails[0] !== nestedTailsBefore[1] || nestedReorderedTails[1] !== nestedTailsBefore[0]) {
    fail('nested keyed rows did not move their original tail nodes');
}

console.log(
    'ssr-named-slot-resume GATE PASS: named projections keep their SSR nodes through hydrate, updates, keyed rows, dynamic names and nested projection',
);


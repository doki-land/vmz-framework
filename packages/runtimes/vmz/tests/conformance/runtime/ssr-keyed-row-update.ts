/**
 * Multi-root `template v-for` rows must keep their DOM nodes across an external
 * state update, not only during hydration.
 *
 * `ssr-keyed-row-fragment` proves the SSR marker pair is reclaimed on hydrate.
 * This gate builds the `keyed-rows` fixture for real, hydrates it and then
 * reorders, edits, removes and adds rows on the live instance. Rows that survive
 * the update must keep the exact element and text node objects they got at
 * hydrate time, so focus, selection, input value and animation state survive.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'keyed-rows');
const dist = path.join(example, 'dist', 'web-ssr');

function fail(msg: string): never {
    console.error(`ssr-keyed-row-update GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ssr-keyed-row-update: vmz build keyed-rows…');
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
if (!pageHtml.includes('<h2')) fail(`SSR page missing rows: ${pageHtml}`);
if (!pageHtml.includes('vmz-row:')) fail('SSR page is missing the fragment row markers');

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${pageHtml}</div></body></html>`);
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;

const app = window.document.getElementById('app');
const inst = await hydrate(IndexPage, app, {});
if (app.innerHTML.includes('vmz-row:')) fail('row markers were not consumed on hydrate');

type Row = { title: string; h2: any; p: any; text: any };
const readRows = (): Row[] => {
    const hs = Array.from(app.querySelectorAll('h2'));
    return hs.map((h: any) => ({
        title: String(h.textContent).trim(),
        h2: h,
        p: h.nextElementSibling,
        text: h.firstChild,
    }));
};

const before = readRows();
if (before.length !== 3) fail(`hydrate produced ${before.length} rows, expected 3`);
const byTitle = new Map(before.map((row) => [row.title, row]));

function expectSameRow(title: string, row: Row | undefined, label: string): void {
    const original = byTitle.get(title);
    if (!original) fail(`${label}: no hydrated row titled "${title}"`);
    if (!row) fail(`${label}: missing row "${title}"`);
    if (row.h2 !== original.h2) fail(`${label}: row "${title}" rebuilt its <h2>`);
    if (row.p !== original.p) fail(`${label}: row "${title}" rebuilt its <p>`);
}

// 1. Reorder: every surviving row keeps both nodes and its text node.
inst.items = [inst.items[2], inst.items[0], inst.items[1]];
await flushPending(inst);
{
    const after = readRows();
    if (after.map((r) => r.title).join(',') !== 'Charlie,Alpha,Bravo') {
        fail(`reorder produced ${after.map((r) => r.title).join(',')}`);
    }
    for (const row of after) expectSameRow(row.title, row, 'reorder');
    const charlie = after[0];
    if (charlie.text !== byTitle.get('Charlie')?.text) fail('reorder rebuilt the "Charlie" text node');
}

// 2. Edit one row: same nodes, updated text in place.
inst.items = [
    inst.items[0],
    { id: 'a', title: 'Alpha prime', body: 'first edited' },
    inst.items[2],
];
await flushPending(inst);
{
    const after = readRows();
    if (after.map((r) => r.title).join(',') !== 'Charlie,Alpha prime,Bravo') {
        fail(`edit produced ${after.map((r) => r.title).join(',')}`);
    }
    // The hydrated row is titled "Alpha" and keeps that identity after the edit.
    expectSameRow('Alpha', after[1], 'edit');
    if (!String(after[1].p.textContent).includes('first edited')) fail('edited body text did not update');
    expectSameRow('Charlie', after[0], 'edit');
    expectSameRow('Bravo', after[2], 'edit');
}

// 3. Remove one row: survivors keep their nodes and the removed nodes detach.
const removed = readRows().find((r) => r.title === 'Bravo');
inst.items = [inst.items[0], inst.items[1]];
await flushPending(inst);
{
    const after = readRows();
    if (after.map((r) => r.title).join(',') !== 'Charlie,Alpha prime') {
        fail(`remove produced ${after.map((r) => r.title).join(',')}`);
    }
    if (!removed) fail('no "Bravo" row before removal');
    if (app.contains(removed.h2) || app.contains(removed.p)) fail('removed row nodes are still in the document');
    expectSameRow('Charlie', after[0], 'remove');
    expectSameRow('Alpha', after[1], 'remove');
}

// 4. Add one row: survivors are untouched and the new row is new.
inst.items = [inst.items[0], inst.items[1], { id: 'd', title: 'Delta', body: 'fourth' }];
await flushPending(inst);
{
    const after = readRows();
    if (after.map((r) => r.title).join(',') !== 'Charlie,Alpha prime,Delta') {
        fail(`add produced ${after.map((r) => r.title).join(',')}`);
    }
    expectSameRow('Charlie', after[0], 'add');
    expectSameRow('Alpha', after[1], 'add');
    const delta = after[2];
    if (before.some((row) => row.h2 === delta.h2 || row.p === delta.p)) {
        fail('added row reused a node from a hydrated row');
    }
    if (delta.h2.nextElementSibling !== delta.p) fail('added row did not keep its multi-root shape');
}

console.log('ssr-keyed-row-update GATE PASS: surviving multi-root rows keep their DOM nodes across updates');

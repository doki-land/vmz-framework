/**
 * Keyed each resume must reclaim SSR rows by `data-vmz-key`.
 *
 * `rowKernel.create` used to clone a fresh row for every key and throw the SSR
 * `<li>` away, so hydration replaced the whole list: a user that already focused
 * or typed into an SSR row lost that node (value, caret, scroll) even though the
 * row markup was identical. Tag-order adoption has the same failure when client
 * state is ahead of the SSR order (persisted state, re-filtered store): the first
 * `<li>` is reused for whichever key renders first, which mixes keys across
 * retained nodes. The create loop therefore asks the resume adopt for the exact
 * key first and only clones when the SSR row is absent.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-keyed-resume GATE FAIL: ${msg}`);
    process.exit(1);
}

/**
 * Mirrors `row_kernel.rs` hydrate for one text slot.
 */
function hydrateRow(node, item) {
    node.__vmzBox = item;
    node.__vmzE = [node];
    node.__vmzT = [node.firstChild];
    node.__vmzT[0].nodeValue = String(item.label);
}

/**
 * Mirrors the emitted kernel create loop: claim by key on resume, clone otherwise,
 * then run the keyed reorder pass. Rows carry a click handler so a rebuilt row can
 * be told apart from a row whose SSR listener survived.
 */
function keyedRowsBody(api, inst) {
    const rootEl = api.el('ul');
    api.adoptEnter(rootEl);
    const start = api.comment('vmz-each:rows');
    const end = api.comment('/vmz-each');
    rootEl.appendChild(start);
    rootEl.appendChild(end);

    const keyed = new Map();
    function keyOf(item) {
        return item.id;
    }
    let rowTpl = null;
    function rowTplNode() {
        if (rowTpl) return rowTpl;
        const wrap = document.createElement('template');
        wrap.innerHTML = '<li> </li>';
        rowTpl = wrap.content.firstElementChild;
        if (!rowTpl) throw new Error('ssr-keyed-resume: row template missing');
        return rowTpl;
    }
    function create(list, startIdx, parent, anchor) {
        for (let i = startIdx; i < list.length; i++) {
            const item = list[i];
            const k = keyOf(item);
            if (keyed.has(k)) continue;
            let node = null;
            const adopt = api._resumeAdopt;
            if (adopt && typeof adopt.claimKeyed === 'function') node = adopt.claimKeyed('li', k);
            if (node) {
                hydrateRow(node, item);
            } else {
                node = rowTplNode().cloneNode(true);
                node.__vmzBox = item;
                const t0 = node.firstChild;
                t0.nodeValue = String(item.label);
                node.__vmzT = [t0];
            }
            api.on(node, 'click', function () {
                if (Array.isArray(this.clicks)) this.clicks.push(k);
            });
            node.__vmzKey = k;
            keyed.set(k, node);
            parent.insertBefore(node, anchor);
        }
    }
    function sync() {
        const list = Array.isArray(inst.rows) ? inst.rows.slice() : [];
        const parent = end.parentNode;
        create(list, 0, parent, end);
        let anchor = end;
        for (let i = list.length - 1; i >= 0; i--) {
            const knode = keyed.get(keyOf(list[i]));
            if (!knode || knode.nodeType !== 1 || knode.parentNode !== parent) continue;
            if (knode.nextSibling !== anchor) parent.insertBefore(knode, anchor);
            anchor = knode;
        }
    }
    sync();
    api.adoptLeave();
    inst.__vmzSyncRows = sync;
    return rootEl;
}

class KeyedRows {
    static __vmzDirect = true;
    static __vmzState = ['rows'];
    rows = [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Bob' },
    ];
    clicks = [];
    static __vmzCreate(api) {
        return keyedRowsBody(api, this);
    }
}

/**
 * Author pattern fixed by this gate's companion change: the field starts from
 * build-time data so hydration has rows to match, and `onMount` refreshes the
 * same keys with fresh objects. The runtime never guesses rows from
 * `data-vmz-key` alone, so an empty field at hydration is a rebuild by design.
 */
class SeededRows {
    static __vmzDirect = true;
    static __vmzState = ['rows'];
    rows = [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Bob' },
    ];
    clicks = [];
    static __vmzCreate(api) {
        return keyedRowsBody(api, this);
    }
    onMount() {
        this.rows = [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Bob' },
        ];
        if (typeof this.__vmzSyncRows === 'function') this.__vmzSyncRows();
    }
}

const { registerComponents, hydrate } = await import(domHref);
registerComponents({ KeyedRows, SeededRows });

function install(inner) {
    const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${inner}</div></body></html>`);
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;
    return window.document.getElementById('app');
}

function listOf(app) {
    return [...app.querySelectorAll('li')].map((li) => ({
        key: li.__vmzKey,
        ssr: li.__probe,
        text: li.textContent.trim(),
    }));
}

const SSR = '<ul><li data-vmz-key="a">Alpha</li><li data-vmz-key="b">Bob</li></ul>';

console.log('ssr-keyed-resume: hydration reclaims the SSR row for the same key…');
{
    const app = install(SSR);
    [...app.querySelectorAll('li')].forEach((li) => {
        li.__probe = li.getAttribute('data-vmz-key');
    });
    await hydrate(KeyedRows, app, {}, { preserveState: { rows: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Bob' }] } });
    const rows = listOf(app);
    if (rows.length !== 2) fail(`hydration kept ${rows.length} rows: ${JSON.stringify(rows)}`);
    for (const row of rows) {
        if (row.ssr !== row.key) fail(`row ${row.key} lost its SSR node (cloned ${row.ssr}): ${JSON.stringify(rows)}`);
    }
}

console.log('ssr-keyed-resume: client order ahead of SSR keeps keys on their own nodes…');
{
    const app = install(SSR);
    [...app.querySelectorAll('li')].forEach((li) => {
        li.__probe = li.getAttribute('data-vmz-key');
    });
    await hydrate(KeyedRows, app, {}, { preserveState: { rows: [{ id: 'b', label: 'Bob' }, { id: 'a', label: 'Alpha' }] } });
    const rows = listOf(app);
    if (rows.map((r) => r.key).join(',') !== 'b,a') fail(`client order not applied: ${JSON.stringify(rows)}`);
    for (const row of rows) {
        if (row.ssr !== row.key) fail(`client row ${row.key} adopted the SSR ${row.ssr} node: ${JSON.stringify(rows)}`);
        if (row.text !== (row.key === 'b' ? 'Bob' : 'Alpha')) fail(`row ${row.key} shows "${row.text}"`);
    }
}

console.log('ssr-keyed-resume: seeded author state survives the onMount refresh…');
{
    const app = install(SSR);
    [...app.querySelectorAll('li')].forEach((li) => {
        li.__probe = li.getAttribute('data-vmz-key');
    });
    const inst = await hydrate(SeededRows, app, {});
    const rows = listOf(app);
    if (rows.length !== 2) fail(`seeded hydration kept ${rows.length} rows: ${JSON.stringify(rows)}`);
    for (const row of rows) {
        if (row.ssr !== row.key) fail(`onMount refresh rebuilt row ${row.key} (cloned ${row.ssr}): ${JSON.stringify(rows)}`);
        if (row.text !== (row.key === 'b' ? 'Bob' : 'Alpha')) fail(`row ${row.key} shows "${row.text}"`);
    }
    app.querySelectorAll('li').forEach((li) => li.dispatchEvent(new globalThis.window.Event('click')));
    if (inst.clicks.join(',') !== 'a,b') fail(`seeded rows lost their handlers after refresh: ${inst.clicks.join(',')}`);
}

console.log('ssr-keyed-resume: mismatched keys rebuild and keep their handlers…');
{
    const app = install(SSR);
    [...app.querySelectorAll('li')].forEach((li) => {
        li.__probe = li.getAttribute('data-vmz-key');
    });
    const inst = await hydrate(SeededRows, app, {}, {
        preserveState: { rows: [{ id: 'b', label: 'Bob' }, { id: 'd', label: 'Delta' }] },
    });
    const rows = listOf(app);
    if (rows.map((r) => r.key).join(',') !== 'b,d') fail(`mismatch rows want b,d got ${JSON.stringify(rows)}`);
    const bRow = rows.find((r) => r.key === 'b');
    if (bRow.ssr !== 'b') fail(`row b must keep its SSR node, got ${bRow.ssr}`);
    const dRow = rows.find((r) => r.key === 'd');
    if (dRow.ssr === 'd') fail('row d has no SSR node and must be rebuilt');
    if (rows.some((r) => r.key === 'a')) fail('stale SSR row a survived the mismatch');
    if (rows.some((r) => r.key === undefined || r.key === null)) fail(`unkeyed SSR residue: ${JSON.stringify(rows)}`);
    app.querySelectorAll('li').forEach((li) => li.dispatchEvent(new globalThis.window.Event('click')));
    if (inst.clicks.length !== 2 || !inst.clicks.includes('b') || !inst.clicks.includes('d')) {
        fail(`rebuilt rows must stay live, clicks=${inst.clicks.join(',')}`);
    }
}

console.log('ssr-keyed-resume GATE PASS: keyed rows reclaim SSR nodes by key');

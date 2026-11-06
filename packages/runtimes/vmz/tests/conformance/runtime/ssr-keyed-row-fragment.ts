/**
 * Multi-root `<template v-for>` rows must carry a parseable SSR identity.
 *
 * A `<template v-for>` row renders a fragment: it has no element root that could
 * carry `data-vmz-key`, so SSR wrote no row identity and resume could only adopt
 * nodes in tag order. Reordering or filtering the client list then attached
 * another key's node (focus, caret, typed value) to the wrong row.
 *
 * Contract: the row fragment serializes `<!--vmz-row:KEY-->` /
 * `<!--vmz-row-end:KEY-->` around its nodes, resume claims by that pair, and the
 * markers never reach the browser DOM. Rows whose marker pair is missing,
 * unbalanced, or already claimed by an earlier key are built fresh.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

const MARKER = '<!--vmz-row:';
const END_MARKER = '<!--vmz-row-end:';

function fail(msg) {
    console.error(`ssr-keyed-row-fragment GATE FAIL: ${msg}`);
    process.exit(1);
}

function assert(cond, msg) {
    if (!cond) fail(msg);
}

const ROWS = [
    { id: 'a', label: 'Alpha', tail: ' tail-a ', n: 1 },
    { id: 'b', label: 'Bob', tail: ' tail-b ', n: 2 },
];

/**
 * Mirrors the emitted non-kernel create loop for a `<template v-for>` row: the
 * row key reaches `api.fragRow`, children are created inside that scope, and
 * `api.rowEnd` closes it before the fragment is handed to the scheduler.
 */
function rowBody(api, inst) {
    const rootEl = api.el('ul');
    api.adoptEnter(rootEl);
    const start = api.comment('vmz-each:rows');
    const end = api.comment('/vmz-each');
    rootEl.appendChild(start);
    rootEl.appendChild(end);

    function keyOf(item) {
        return item.id;
    }

    function createRow(box) {
        const frag = api.fragRow(box.__vmzKey);
        const em = api.el('em');
        // Gate-only probe: the contract puts no key on the row's roots, so the
        // test needs its own handle to tell which node belongs to which key.
        api.attr(em, 'data-row-key', box.__vmzKey);
        api.adoptEnter(em);
        em.appendChild(api.text(box.item.label));
        api.adoptLeave();
        frag.appendChild(em);
        frag.appendChild(api.text(box.item.tail));
        const span = api.el('span');
        api.adoptEnter(span);
        span.appendChild(api.text(String(box.item.n)));
        api.adoptLeave();
        frag.appendChild(span);
        api.rowEnd();
        return frag;
    }

    function apply() {
        const keyed = new Map();
        const list = Array.isArray(inst.rows) ? inst.rows.slice() : [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const key = keyOf(item);
            if (keyed.has(key)) continue;
            const box = { item: item, index: i, __vmzKey: key };
            let dom = createRow(box);
            if (dom && dom.nodeType === 11) {
                const rowNodes = [];
                while (dom.firstChild) rowNodes.push(dom.removeChild(dom.firstChild));
                dom = rowNodes;
            }
            keyed.set(key, dom);
            const host = end.parentNode;
            if (Array.isArray(dom)) {
                for (const node of dom) host.insertBefore(node, end);
            } else if (dom) {
                // SSR: the row fragment serializes its marker pair as one node.
                host.insertBefore(dom, end);
            }
        }
        let anchor = end;
        const hostParent = anchor.parentNode;
        for (let i = list.length - 1; i >= 0; i--) {
            const rowNodes = keyed.get(keyOf(list[i]));
            const nodes = Array.isArray(rowNodes) ? rowNodes : null;
            if (!nodes || !nodes.length || nodes[0].parentNode !== hostParent) continue;
            const last = nodes[nodes.length - 1];
            if (last.nextSibling !== anchor) {
                for (const node of nodes) hostParent.insertBefore(node, anchor);
            }
            anchor = nodes[0];
        }
    }

    apply();
    api.adoptLeave();
    inst.__vmzSyncRows = apply;
    return rootEl;
}

class FragmentRows {
    static __vmzDirect = true;
    static __vmzState = ['rows'];
    rows = ROWS.map((row) => ({ ...row }));
    static __vmzCreate(api) {
        return rowBody(api, this);
    }
}

const { registerComponents, renderToString, hydrate } = await import(domHref);
registerComponents({ FragmentRows });

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

/** Rows are the `<em>` roots; each row also owns the text node between `em` and `span`. */
function rowsOf(app) {
    return [...app.querySelectorAll('ul > em')].map((em) => {
        const tail = em.nextSibling;
        return {
            key: em.getAttribute('data-row-key'),
            em: em.__probe,
            tail: tail && tail.nodeType === 3 ? tail.__probe : null,
            label: em.textContent,
            tailText: tail && tail.nodeType === 3 ? tail.textContent : '',
        };
    });
}

function probe(app) {
    for (const em of [...app.querySelectorAll('ul > em')]) {
        const key = em.getAttribute('data-row-key');
        em.__probe = key;
        const tail = em.nextSibling;
        if (tail && tail.nodeType === 3) tail.__probe = key;
        const span = tail && tail.nextSibling;
        if (span && span.nodeType === 1) span.__probe = key;
    }
}

console.log('ssr-keyed-row-fragment: single-root template v-for rows serialize marker pairs…');
const SSR = await renderToString(FragmentRows, { props: {} });
assert(SSR.includes(`${MARKER}a-->`), `SSR missing row start marker: ${SSR}`);
assert(SSR.includes(`${END_MARKER}a-->`), `SSR missing row end marker: ${SSR}`);
assert(SSR.includes(`${MARKER}b-->`) && SSR.includes(`${END_MARKER}b-->`), `SSR missing b markers: ${SSR}`);
assert(!SSR.includes('data-vmz-key="a"'), `fragment rows must not put the key on a child: ${SSR}`);
console.log('ssr-keyed-row-fragment: marker pairs are in the SSR output');

console.log('ssr-keyed-row-fragment: reversed client order keeps each row’s SSR nodes…');
{
    const app = install(SSR);
    probe(app);
    await hydrate(FragmentRows, app, {}, { preserveState: { rows: [ROWS[1], ROWS[0]] } });
    const rows = rowsOf(app);
    assert(rows.map((row) => row.key).join(',') === 'b,a', `client order not applied: ${JSON.stringify(rows)}`);
    for (const row of rows) {
        const want = row.key === 'b' ? 'Bob' : 'Alpha';
        assert(row.label === want, `row ${row.key} shows "${row.label}"`);
        assert(row.em === row.key, `row ${row.key} rebuilt its element (adopted ${row.em})`);
        assert(row.tail === row.key, `row ${row.key} rebuilt its text node (adopted ${row.tail})`);
    }
    assert(!app.innerHTML.includes('vmz-row'), `row markers must not survive resume: ${app.innerHTML}`);
    assert(app.querySelectorAll('ul > em').length === 2, `stale rows survived: ${app.innerHTML}`);
}
console.log('ssr-keyed-row-fragment: rows reclaim their own nodes after reorder');

console.log('ssr-keyed-row-fragment: row count changes rebuild missing rows and drop stale ones…');
{
    const app = install(SSR);
    probe(app);
    const visible = {
        preserveState: { rows: [ROWS[0], { id: 'd', label: 'Delta', tail: ' tail-d ', n: 4 }] },
    };
    await hydrate(FragmentRows, app, {}, visible);
    const rows = rowsOf(app);
    assert(rows.map((row) => row.key).join(',') === 'a,d', `row set wants a,d got ${JSON.stringify(rows)}`);
    const a = rows.find((row) => row.key === 'a');
    const d = rows.find((row) => row.key === 'd');
    assert(a.em === 'a' && a.tail === 'a', `row a must keep its SSR nodes: ${JSON.stringify(a)}`);
    assert(d.em !== 'd', `row d has no SSR counterpart and must be rebuilt: ${JSON.stringify(d)}`);
    assert(!rows.some((row) => row.key === 'b'), `stale SSR row b survived: ${JSON.stringify(rows)}`);
}
console.log('ssr-keyed-row-fragment: row count changes are fail-closed');

console.log('ssr-keyed-row-fragment: duplicate row keys never steal another key’s nodes…');
{
    const duplicate = `<ul>${MARKER}a--><em data-row-key="a">Alpha</em> tail-a <span>1</span>${END_MARKER}a-->${MARKER}a--><em data-row-key="a">Alpha2</em> tail-a2 <span>9</span>${END_MARKER}a-->${MARKER}b--><em data-row-key="b">Bob</em> tail-b <span>2</span>${END_MARKER}b--></ul>`;
    const app = install(duplicate);
    probe(app);
    await hydrate(FragmentRows, app, {}, { preserveState: { rows: ROWS } });
    const rows = rowsOf(app);
    assert(rows.map((row) => row.key).join(',') === 'a,b', `rows want a,b got ${JSON.stringify(rows)}`);
    const a = rows.find((row) => row.key === 'a');
    const b = rows.find((row) => row.key === 'b');
    assert(a.em === 'a' && a.tail === 'a', `first a must claim the first pair: ${JSON.stringify(a)}`);
    assert(a.label === 'Alpha', `first a must not mix in the duplicate pair: ${JSON.stringify(a)}`);
    assert(b.em === 'b' && b.tail === 'b', `b must claim its own pair: ${JSON.stringify(b)}`);
    assert(app.querySelectorAll('ul > em').length === 2, `duplicate row survived: ${app.innerHTML}`);
}
console.log('ssr-keyed-row-fragment: duplicate keys are fail-closed');

console.log('ssr-keyed-row-fragment: mixed element and text roots keep one row scope…');
{
    const app = install(SSR);
    probe(app);
    await hydrate(FragmentRows, app, {}, { preserveState: { rows: [ROWS[0], ROWS[1]] } });
    const rows = rowsOf(app);
    for (const row of rows) {
        assert(row.tailText.trim().length > 0, `text root missing in row ${row.key}: ${JSON.stringify(row)}`);
    }
    const a = rows.find((row) => row.key === 'a');
    assert(a.tailText === ' tail-a ', `text root not adopted in row a: "${a.tailText}"`);
}
console.log('ssr-keyed-row-fragment GATE PASS: fragment rows reclaim SSR nodes by marker pair');

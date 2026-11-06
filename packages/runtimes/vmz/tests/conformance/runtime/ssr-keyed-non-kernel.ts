/**
 * Keyed non-kernel rows must reclaim SSR nodes by identity.
 *
 * Component rows and `v-once` / `v-memo` rows have no row kernel, so their roots
 * never carried `data-vmz-key`: SSR emitted the host/`<li>` without a key and
 * resume could only take the next node in tag order. Reordered or filtered client
 * state then adopted another key's SSR node, mixing retained values across rows.
 * The emitter now writes the key into the row box and passes it to `api.el` /
 * `api.component`, so SSR serializes `data-vmz-key` and resume matches on it.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-keyed-non-kernel GATE FAIL: ${msg}`);
    process.exit(1);
}

const SSR_ITEMS = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Bob' },
];

class KeyedCard {
    static __vmzDirect = true;
    static __vmzState = ['label'];
    label = '';
    constructor(props = {}) {
        this.label = String(props.label ?? '');
    }
    static __vmzCreate(api) {
        const p = api.el('p');
        api.attr(p, 'data-card', this.label);
        p.appendChild(api.text(this.label));
        return p;
    }
}

/**
 * Mirrors the emitted non-kernel create loop: `box.__vmzKey` reaches the root
 * (`api.el(tag, key)` or `api.component(..., key)`), rows insert before `end`,
 * then the backward reorder pass moves keyed nodes into client order.
 */
function makeRows(useComponent) {
    return class KeyedRows {
        static __vmzDirect = true;
        static __vmzState = ['items'];
        items = SSR_ITEMS.map((item) => ({ ...item }));
        static __vmzCreate(api) {
            const inst = this;
            const rootEl = api.el('ul');
            api.adoptEnter(rootEl);
            const start = api.comment('vmz-each:items');
            const end = api.comment('/vmz-each');
            rootEl.appendChild(start);
            rootEl.appendChild(end);

            function keyOf(item) {
                return item.id;
            }
            function createRow(box) {
                if (useComponent) return api.component(inst, 'KeyedCard', { label: box.item.label }, null, box.__vmzKey);
                const li = api.el('li', box.__vmzKey);
                api.attr(li, 'data-label', box.item.label);
                li.appendChild(api.text(box.item.label));
                return li;
            }

            const keyed = new Map();
            const list = Array.isArray(inst.items) ? inst.items.slice() : [];
            const parent = end.parentNode;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                const key = keyOf(item);
                if (keyed.has(key)) continue;
                const box = { item: item, index: i, __vmzKey: key };
                const dom = createRow(box);
                keyed.set(key, dom);
                if (parent) parent.insertBefore(dom, end);
            }
            let anchor = end;
            for (let i = list.length - 1; i >= 0; i--) {
                const knode = keyed.get(keyOf(list[i]));
                if (!knode || knode.nodeType !== 1 || knode.parentNode !== parent) continue;
                if (knode.nextSibling !== anchor) parent.insertBefore(knode, anchor);
                anchor = knode;
            }
            api.adoptLeave();
            return rootEl;
        }
    };
}

const ElementRows = makeRows(false);
const ComponentRows = makeRows(true);

const { registerComponents, renderToString, hydrate } = await import(domHref);
registerComponents({ ElementRows, ComponentRows, KeyedCard });

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

function rootsOf(app, useComponent) {
    const nodes = useComponent ? [...app.querySelectorAll('div[data-vmz="KeyedCard"]')] : [...app.querySelectorAll('ul > li')];
    return nodes.map((node) => ({
        key: node.getAttribute('data-vmz-key'),
        ssr: node.__probe,
        text: useComponent ? node.textContent.trim() : node.getAttribute('data-label'),
    }));
}

async function check(useComponent) {
    const label = useComponent ? 'component' : 'v-once element';
    const html = await renderToString(useComponent ? ComponentRows : ElementRows, { props: {} });
    if (!html.includes('data-vmz-key="a"') || !html.includes('data-vmz-key="b"')) {
        fail(`${label} SSR missing row keys: ${html}`);
    }
    const app = install(html);
    for (const node of rootsOf(app, useComponent)) {
        const el = useComponent ? app.querySelector(`div[data-vmz-key="${node.key}"]`) : app.querySelector(`li[data-vmz-key="${node.key}"]`);
        el.__probe = node.key;
    }
    const reversed = { preserveState: { items: [{ id: 'b', label: 'Bob' }, { id: 'a', label: 'Alpha' }] } };
    await hydrate(useComponent ? ComponentRows : ElementRows, app, {}, reversed);
    const rows = rootsOf(app, useComponent);
    if (rows.map((r) => r.key).join(',') !== 'b,a') fail(`${label} client order not applied: ${JSON.stringify(rows)}`);
    for (const row of rows) {
        if (row.ssr !== row.key) fail(`${label} row ${row.key} adopted the SSR ${row.ssr} node: ${JSON.stringify(rows)}`);
        if (row.text !== (row.key === 'b' ? 'Bob' : 'Alpha')) fail(`${label} row ${row.key} shows "${row.text}"`);
    }
    console.log(`ssr-keyed-non-kernel: ${label} rows keep their SSR node after reorder`);
}

console.log('ssr-keyed-non-kernel: keyed v-once rows serialize `data-vmz-key`…');
await check(false);
console.log('ssr-keyed-non-kernel: keyed component rows serialize `data-vmz-key`…');
await check(true);
console.log('ssr-keyed-non-kernel GATE PASS: non-kernel rows reclaim SSR nodes by key');

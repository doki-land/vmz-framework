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

/** Mirrors `row_kernel.rs` hydrate for one text slot. */
function hydrateRow(node, item) {
    node.__vmzBox = item;
    node.__vmzE = [node];
    node.__vmzT = [node.firstChild];
    node.__vmzT[0].nodeValue = String(item.label);
}

/**
 * Mirrors the emitted kernel create loop: claim by key on resume, clone otherwise,
 * then run the keyed reorder pass.
 */
class KeyedRows {
    static __vmzDirect = true;
    static __vmzState = ['rows'];
    rows = [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Bob' },
    ];
    static __vmzCreate(api) {
        const inst = this;
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
        function create(list, startIdx, tpl, keyed, parent, end, keyOf) {
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
                    node = tpl.cloneNode(true);
                    node.__vmzBox = item;
                    const t0 = node.firstChild;
                    t0.nodeValue = String(item.label);
                    node.__vmzT = [t0];
                }
                node.__vmzKey = k;
                keyed.set(k, node);
                parent.insertBefore(node, end);
            }
        }

        const list = Array.isArray(inst.rows) ? inst.rows.slice() : [];
        const parent = end.parentNode;
        create(list, 0, rowTplNode(), keyed, parent, end, keyOf);
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
}

const { registerComponents, hydrate } = await import(domHref);
registerComponents({ KeyedRows });

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

console.log('ssr-keyed-resume GATE PASS: keyed rows reclaim SSR nodes by key');

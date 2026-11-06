/**
 * direct-vhtml-hydrate — `v-html` must keep the SSR subtree when the markup matches.
 *
 * Direct emit registers the `v-html` patch at create time (`trackPatch` runs the
 * patch immediately), so a plain `el.innerHTML = value` re-parses the SSR payload
 * that resume just reclaimed. Emitted code now asks `api.reclaimHtml(el, value)`
 * first: resume parks SSR children in a private pool, so it moves them back and
 * compares the live markup — equal keeps every SSR node, different still writes
 * (data changes must repaint). This gate mirrors that emitted statement.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`direct-vhtml-hydrate GATE FAIL: ${msg}`);
    process.exit(1);
}

function installDom(window) {
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;
}

const { registerComponents, renderToString, hydrate, flushPending } = await import(domHref);

/** Table payloads survive HTML parsing byte-identically, so equality is exact. */
const initialHtml =
    '<table><thead><tr><th scope="col">day</th></tr></thead><tbody><tr><td>mon</td></tr></tbody></table>';

class HtmlFixture {
    static __vmzDirect = true;
    static __vmzState = ['markup'];
    markup = initialHtml;

    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'html-root');
        const target = api.el('div');
        api.attr(target, 'data-fixture', 'html-target');
        // Same shape as the emitted `v-html` patch: reclaim before writing.
        api.trackPatch(
            this,
            ['markup'],
            function () {
                var __v;
                try {
                    __v = this.markup;
                } catch {
                    __v = null;
                }
                var __s = __v == null ? '' : String(__v);
                if (!(api.reclaimHtml && api.reclaimHtml(target, __s)) && target.innerHTML !== __s) {
                    target.innerHTML = __s;
                }
            },
            null,
        );
        rootEl.appendChild(target);
        return rootEl;
    }
}

registerComponents({ HtmlFixture });

const ssrHtml = await renderToString(HtmlFixture, { props: {} });
if (!ssrHtml.includes('<th scope="col">day</th>')) fail(`SSR v-html payload missing: ${ssrHtml}`);

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${ssrHtml}</div></body></html>`);
installDom(window);
const app = window.document.getElementById('app');
const target = app.querySelector('[data-fixture="html-target"]');
if (!target) fail('SSR target missing');

const ssrNodes = [];
{
    const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
            ssrNodes.push(c);
            if (c.nodeType === 1) walk(c);
        }
    };
    walk(target);
}
if (!ssrNodes.length) fail('SSR payload rendered no nodes');

const inst = await hydrate(HtmlFixture, app, {});

// 1. Matching markup: resume must keep every SSR node of the payload.
if (!app.querySelector('[data-fixture="html-target"]')) fail('target lost after hydrate');
if (app.querySelector('[data-fixture="html-target"]') !== target) fail('target element was recreated');
if (!target.innerHTML.includes('mon')) fail(`payload lost after hydrate: ${target.innerHTML}`);
const drifted = ssrNodes.filter((n) => !n.parentNode || !target.contains(n));
if (drifted.length) {
    fail(`${drifted.length}/${ssrNodes.length} SSR payload node(s) were dropped on matching hydrate`);
}
console.log(`direct-vhtml-hydrate: matching hydrate kept ${ssrNodes.length}/${ssrNodes.length} SSR nodes`);

// 2. Data change: the guard must not freeze the payload.
inst.markup = '<table><tbody><tr><td>tue</td></tr></tbody></table>';
await flushPending(inst);
if (!target.innerHTML.includes('tue')) fail(`v-html did not update on markup change: ${target.innerHTML}`);

// 3. Same value again: still no rewrite of the live subtree.
const kept = [...target.childNodes];
await flushPending(inst);
const replaced = kept.filter((n) => !target.contains(n));
if (replaced.length) fail(`unchanged re-run re-parsed ${replaced.length} node(s)`);
console.log('direct-vhtml-hydrate: data changes still repaint, unchanged re-runs keep nodes');

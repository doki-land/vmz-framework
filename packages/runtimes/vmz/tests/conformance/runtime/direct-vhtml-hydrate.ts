/**
 * direct-vhtml-hydrate — `v-html` keeps the SSR subtree through a payload digest.
 *
 * Direct emit registers the `v-html` patch at create time (`trackPatch` runs the
 * patch immediately), so a plain assignment re-parses the SSR payload that resume
 * just reclaimed. The browser serializer also expands self-closing tags
 * (`<path d="M0 0"/>` becomes `<path d="M0 0"></path>`), so comparing the
 * generated string with live `innerHTML` can never match SVG payloads.
 *
 * Contract: SSR stamps `data-vmz-html-hash` with the digest of the exact string
 * it wrote, and `api.html` compares that marker with the digest of the string it
 * would write. Equal keeps the parked SSR subtree, different writes the new
 * payload and refreshes the marker. The digest covers the generated string only.
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

/** Self-closing SVG: the browser serializer expands it, so only a digest can match. */
const initialHtml =
    '<svg viewBox="0 0 10 10"><path d="M0 0"/><rect x="0" y="0" width="4" height="4"/></svg>';

class HtmlFixture {
    static __vmzDirect = true;
    static __vmzState = ['markup'];
    markup = initialHtml;

    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'html-root');
        const target = api.el('div');
        api.attr(target, 'data-fixture', 'html-target');
        // Same shape as the emitted `v-html` patch.
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
                api.html(target, __s);
            },
            null,
        );
        rootEl.appendChild(target);
        return rootEl;
    }
}

registerComponents({ HtmlFixture });

const ssrHtml = await renderToString(HtmlFixture, { props: {} });
if (!ssrHtml.includes('<path d="M0 0"/>')) fail(`SSR v-html raw payload missing: ${ssrHtml}`);
if (!ssrHtml.includes('data-vmz-html-hash="')) fail(`SSR v-html host lacks the digest marker: ${ssrHtml}`);

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${ssrHtml}</div></body></html>`);
installDom(window);
const app = window.document.getElementById('app');
const target = app.querySelector('[data-fixture="html-target"]');
if (!target) fail('SSR target missing');
const ssrStamp = target.getAttribute('data-vmz-html-hash');
if (!ssrStamp) fail('digest marker missing on the parsed SSR host');

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

// 1. Matching digest: resume must keep every SSR node even though the parsed
//    markup string is not byte-identical to the generated payload.
if (!app.querySelector('[data-fixture="html-target"]')) fail('target lost after hydrate');
if (app.querySelector('[data-fixture="html-target"]') !== target) fail('target element was recreated');
const liveMarkup = target.innerHTML;
if (!liveMarkup.includes('path')) fail(`payload lost after hydrate: ${liveMarkup}`);
const drifted = ssrNodes.filter((n) => !n.parentNode || !target.contains(n));
if (drifted.length) {
    fail(`${drifted.length}/${ssrNodes.length} SSR payload node(s) were dropped on matching hydrate`);
}
if (target.getAttribute('data-vmz-html-hash') !== ssrStamp) fail('digest marker changed without a payload change');
const canonicalGap = liveMarkup !== initialHtml;
console.log(
    `direct-vhtml-hydrate: matching hydrate kept ${ssrNodes.length}/${ssrNodes.length} SSR nodes` +
        (canonicalGap ? ' (serialized markup differs from the generated string)' : ''),
);

// 2. Data change: the digest must not freeze the payload.
inst.markup = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
await flushPending(inst);
if (!target.innerHTML.includes('circle')) fail(`v-html did not update on markup change: ${target.innerHTML}`);
const changedStamp = target.getAttribute('data-vmz-html-hash');
if (changedStamp !== null && changedStamp === ssrStamp) fail('digest marker was not refreshed after a payload change');

// 3. Same value again: the refreshed marker short-circuits the write.
const kept = [...target.childNodes];
await flushPending(inst);
const replaced = kept.filter((n) => !target.contains(n));
if (replaced.length) fail(`unchanged re-run re-parsed ${replaced.length} node(s)`);
console.log('direct-vhtml-hydrate: data changes still repaint, unchanged re-runs keep nodes');

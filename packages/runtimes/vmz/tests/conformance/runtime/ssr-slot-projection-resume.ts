/**
 * Resume must reclaim multi-root slot projection and component hosts inside it.
 *
 * Direct SSR flattens `<slot/>`: projected children are written in place and the
 * page HTML has no `<slot>` anchor. On the client `runDirectResume` reclaims the
 * first projection root, but `adoptEnter` returned without pushing a scope whenever
 * a node had no SSR counterpart (fresh element / fresh component host). The paired
 * emitted `adoptLeave` then popped the caller's scope, so every rebuilt node drifted
 * the adopt stack one level up. Once a component inside projection root 2 built any
 * fresh node, roots 3..n were searched in the wrong pool and rebuilt with their
 * whole subtree on every page load (product page: 42 rebuilt nodes).
 *
 * This gate covers:
 * 1. multi-root default slot projection (4 roots + `<hr>`) is fully reclaimed
 * 2. a component host projected inside the slot is reclaimed with its children
 * 3. an inline chip host (`<span data-vmz>`) inside `<p>` is reclaimed, so the
 *    SSR markup stays parse-stable instead of being hoisted out of the paragraph
 * 4. one SSR node missing (client-only capability node) is rebuilt, and every
 *    later projection root is still reclaimed (scope drift regression guard)
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-slot-projection-resume GATE FAIL: ${msg}`);
    process.exit(1);
}

function collect(node) {
    const out = [];
    const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 || c.nodeType === 3) out.push(c);
            if (c.nodeType === 1) walk(c);
        }
    };
    walk(node);
    return out;
}

class Prose {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const article = api.el('article');
        api.attr(article, 'data-fixture', 'prose');
        api.adoptEnter(article);
        const slot = api.el('slot');
        article.appendChild(slot);
        api.adoptLeave();
        return article;
    }
}

class Callout {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const box = api.el('div');
        api.attr(box, 'data-fixture', 'callout');
        api.adoptEnter(box);
        const slot = api.el('slot');
        box.appendChild(slot);
        api.adoptLeave();
        return box;
    }
}

class Link {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const a = api.el('a');
        api.attr(a, 'data-fixture', 'link');
        api.adoptEnter(a);
        const slot = api.el('slot');
        a.appendChild(slot);
        api.adoptLeave();
        return a;
    }
}

class SlotPage {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const host = api.component(this, Prose, {}, null);
        api.adoptEnter(host);

        // root 0: plain element subtree
        const first = api.el('div');
        api.attr(first, 'data-fixture', 'root-0');
        api.adoptEnter(first);
        const h1 = api.el('h1');
        api.adoptEnter(h1);
        h1.appendChild(api.text('title'));
        api.adoptLeave();
        first.appendChild(h1);
        api.adoptLeave();
        api.projectDefaultSlot(host, first);

        // root 1: component host projected inside the slot, with its own children
        const second = api.el('div');
        api.attr(second, 'data-fixture', 'root-1');
        api.adoptEnter(second);
        const callout = api.component(this, Callout, {}, null);
        api.adoptEnter(callout);
        const calloutBody = api.el('span');
        api.adoptEnter(calloutBody);
        calloutBody.appendChild(api.text('body'));
        api.adoptLeave();
        api.projectDefaultSlot(callout, calloutBody);
        api.adoptLeave();
        second.appendChild(callout);
        api.adoptLeave();
        api.projectDefaultSlot(host, second);

        // root 2: plain element whose SSR subtree lost a node on the client
        const third = api.el('div');
        api.attr(third, 'data-fixture', 'root-2');
        api.adoptEnter(third);
        const h2 = api.el('h2');
        api.adoptEnter(h2);
        h2.appendChild(api.text('subtitle'));
        api.adoptLeave();
        third.appendChild(h2);
        const onlyClient = api.el('b');
        api.attr(onlyClient, 'data-fixture', 'client-only');
        api.adoptEnter(onlyClient);
        onlyClient.appendChild(api.text('client'));
        api.adoptLeave();
        third.appendChild(onlyClient);
        api.adoptLeave();
        api.projectDefaultSlot(host, third);

        // root 3: `<hr>`
        const rule = api.el('hr');
        api.adoptEnter(rule);
        api.adoptLeave();
        api.projectDefaultSlot(host, rule);

        // root 4: inline chip host inside `<p>`
        const para = api.el('p');
        api.attr(para, 'data-fixture', 'root-4');
        api.adoptEnter(para);
        const link = api.component(this, Link, {}, null);
        api.adoptEnter(link);
        const label = api.text('docs');
        api.projectDefaultSlot(link, label);
        api.adoptLeave();
        para.appendChild(link);
        para.appendChild(api.text(' tail'));
        api.adoptLeave();
        api.projectDefaultSlot(host, para);

        api.adoptLeave();
        return host;
    }
}

const { registerComponents, renderToString, hydrate } = await import(domHref);
registerComponents({ Prose, Callout, Link, SlotPage });

const html = await renderToString(SlotPage, { props: {} });
if (html.includes('<slot')) fail('SSR still emits a `<slot>` anchor, projection is not flattened');
if (!html.includes('<span data-vmz="Link"')) fail(`inline chip host is not a parse-stable <span>: ${html.slice(0, 1200)}`);
if (!html.includes('<div data-vmz="Callout"')) fail('block component host must stay a <div>');

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;

const app = window.document.getElementById('app');
const article = app.querySelector('.vmz-ui-prose') || app.querySelector('article');
if (!article) fail('SSR payload lost the projected component');

const ssrRoots = Array.from(article.children);
if (ssrRoots.length !== 5) fail(`expected 5 projection roots, got ${ssrRoots.length}`);
const [root0, root1, root2, root3, root4] = ssrRoots;
const ssrH1 = root0.firstElementChild;
const ssrCallout = root1.firstElementChild;
const ssrCalloutBody = ssrCallout.firstElementChild;
const ssrH2 = root2.firstElementChild;
const ssrRule = root3;
const ssrPara = root4;
const ssrLink = ssrPara.firstElementChild;
if (!ssrLink || ssrLink.tagName.toLowerCase() !== 'span') fail('SSR Link host is not the inline chip span');
if (ssrLink.textContent !== 'docs') fail(`SSR Link projected text "${ssrLink.textContent}"`);

// Simulate a client-only capability node: the SSR subtree has one node fewer than
// the client create, so the client rebuilds it while hydrating the same parent.
const ssrClientOnly = Array.from(root2.children).find((el) => el.getAttribute('data-fixture') === 'client-only');
if (!ssrClientOnly) fail('fixture SSR tree missing the client-only node');
root2.removeChild(ssrClientOnly);

const before = collect(app);
const removed = new Set([ssrClientOnly, ...(ssrClientOnly.firstChild ? [ssrClientOnly.firstChild] : [])]);
const keptSsr = before.filter((n) => !removed.has(n));
const seen = new WeakSet(keptSsr);

console.log('ssr-slot-projection-resume: hydrate multi-root projection…');
await hydrate(SlotPage, app, {});

const afterRoots = Array.from(article.children);
if (afterRoots.length !== 5) fail(`hydrate left ${afterRoots.length} projection roots: ${article.innerHTML}`);
if (afterRoots[0] !== root0) fail('projection root 0 replaced on hydrate');
if (afterRoots[1] !== root1) fail('projection root 1 replaced on hydrate (component host in slot was rebuilt)');
if (afterRoots[2] !== root2) fail('projection root 2 replaced after a client-only node was rebuilt');
if (afterRoots[3] !== root3) fail('projection root 3 (<hr>) replaced on hydrate (adopt scope drifted)');
if (afterRoots[4] !== root4) fail('projection root 4 (<p>) replaced on hydrate (adopt scope drifted)');

if (root0.firstElementChild !== ssrH1) fail('root 0 subtree rebuilt');
if (root1.firstElementChild !== ssrCallout) fail('projected Callout host rebuilt');
if (ssrCallout.firstElementChild !== ssrCalloutBody) fail('projected Callout children rebuilt');
if (ssrCalloutBody.textContent !== 'body') fail(`projected Callout text "${ssrCalloutBody.textContent}"`);
if (root2.firstElementChild !== ssrH2) fail('root 2 leading subtree rebuilt');
if (ssrPara.firstElementChild !== ssrLink) fail('inline Link host in `<p>` was rebuilt');

const live = collect(app);
for (const node of keptSsr) {
    if (!live.includes(node)) fail(`SSR node dropped from the hydrated tree: ${node.nodeType === 1 ? node.outerHTML.slice(0, 80) : node.textContent}`);
}
const created = live.filter((n) => !seen.has(n));
const createdElements = created.filter((n) => n.nodeType === 1);
if (createdElements.length !== 1) {
    fail(`expected exactly 1 rebuilt element (the client-only node), got ${createdElements.length}: ${createdElements.map((n) => n.outerHTML.slice(0, 90))}`);
}
if (createdElements[0].getAttribute('data-fixture') !== 'client-only') {
    fail(`rebuilt the wrong element: ${createdElements[0].outerHTML.slice(0, 90)}`);
}

console.log('ssr-slot-projection-resume GATE PASS: multi-root projection and projected hosts are reclaimed');

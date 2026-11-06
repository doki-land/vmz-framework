/**
 * SSR default-slot projection must drop `<slot>` fallback children.
 *
 * The client replaces the live `<slot>` with the first projected node, which
 * discards the fallback subtree. The SSR serializer appended projections to the
 * fallback children instead, so the first response painted both ("Fallback
 * content" then the real projection) and hydration removed the fallback.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-slot-fallback GATE FAIL: ${msg}`);
    process.exit(1);
}

class Card {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'class', 'card');
        const slot = api.el('slot');
        const fallback = api.el('span');
        api.attr(fallback, 'data-fixture', 'fallback');
        fallback.appendChild(api.text('Fallback content'));
        slot.appendChild(fallback);
        rootEl.appendChild(slot);
        return rootEl;
    }
}

class ProjectedPage {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'projected-page');
        const card = api.component(this, 'Card', {}, null);
        api.adoptEnter(card);
        const projected = api.el('span');
        api.attr(projected, 'data-fixture', 'projected');
        projected.appendChild(api.text('Projected content'));
        api.projectDefaultSlot(card, projected);
        api.adoptLeave();
        rootEl.appendChild(card);
        return rootEl;
    }
}

class EmptyPage {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'empty-page');
        const card = api.component(this, 'Card', {}, null);
        rootEl.appendChild(card);
        return rootEl;
    }
}

const { registerComponents, renderToString, hydrate } = await import(domHref);
registerComponents({ Card, ProjectedPage, EmptyPage });

console.log('ssr-slot-fallback: SSR drops fallback when the slot is projected…');
const projectedHtml = await renderToString(ProjectedPage, { props: {} });
if (!projectedHtml.includes('data-fixture="projected"')) {
    fail(`SSR missing projected node: ${projectedHtml}`);
}
if (projectedHtml.includes('data-fixture="fallback"')) {
    fail(`SSR painted slot fallback alongside the projection: ${projectedHtml}`);
}

const emptyHtml = await renderToString(EmptyPage, { props: {} });
if (!emptyHtml.includes('data-fixture="fallback"')) {
    fail(`SSR dropped slot fallback without a projection: ${emptyHtml}`);
}

function install(html) {
    const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;
    return window.document.getElementById('app');
}

function snapshot(node) {
    if (node.nodeType === 3) return `#text:${node.textContent}`;
    if (node.nodeType !== 1) return '';
    const attrs = [...node.attributes].map((a) => `${a.name}=${a.value}`).sort();
    const kids = [...node.childNodes].map(snapshot).filter(Boolean).join(',');
    return `${node.tagName.toLowerCase()}(${attrs.join(';')}){${kids}}`;
}

console.log('ssr-slot-fallback: hydration keeps the projected SSR DOM…');
const projectedDom = install(projectedHtml);
const projectedBefore = snapshot(projectedDom);
await hydrate(ProjectedPage, projectedDom);
if (snapshot(projectedDom) !== projectedBefore) {
    fail(`ProjectedPage: hydration rewrote the SSR DOM\nbefore: ${projectedBefore}\nafter:  ${snapshot(projectedDom)}`);
}
if (projectedDom.querySelector('[data-fixture="fallback"]')) {
    fail('ProjectedPage: fallback survived hydration');
}
if (!projectedDom.querySelector('[data-fixture="projected"]')) {
    fail('ProjectedPage: projected node missing after hydration');
}

// Unprojected fallback stays visible. Resume may (re)create the `<slot>` wrapper
// that SSR flattens, so compare the rendered text rather than the exact tag.
console.log('ssr-slot-fallback: unprojected fallback survives hydration…');
const emptyDom = install(emptyHtml);
await hydrate(EmptyPage, emptyDom);
if (!emptyDom.querySelector('[data-fixture="fallback"]')) {
    fail('EmptyPage: fallback missing after hydration');
}
if (emptyDom.textContent !== 'Fallback content') {
    fail(`EmptyPage: fallback text changed after hydration: ${emptyDom.textContent}`);
}

console.log('ssr-slot-fallback GATE PASS: slot fallback matches client replacement');

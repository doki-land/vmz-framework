/**
 * SSR first response must already contain `v-text` content and `v-show` display.
 *
 * Direct emit writes `el.textContent` for v-text and `el.style.display` for
 * v-show (static `api.setText` / `api.setShow`, reactive `trackPatch`). The SSR
 * serializer previously ignored both DOM property writes: static v-text threw
 * (`api.setText is not a function`), reactive v-text shipped an empty element,
 * and v-show=false shipped a visible element that hydration then hid.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-text-show GATE FAIL: ${msg}`);
    process.exit(1);
}

/** Mirrors emit_direct.rs static `v-text` / `v-show` statements. */
class StaticTextShow {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'static-text-show');
        const textEl = api.el('p');
        api.attr(textEl, 'data-fixture', 'static-text');
        api.setText(textEl, 'server text');
        rootEl.appendChild(textEl);
        const hiddenEl = api.el('p');
        api.attr(hiddenEl, 'data-fixture', 'static-hidden');
        api.attr(hiddenEl, 'style', 'color: red');
        api.setShow(hiddenEl, false);
        hiddenEl.appendChild(api.text('hidden body'));
        rootEl.appendChild(hiddenEl);
        return rootEl;
    }
}

/** Mirrors emit_bind_show / emit_bind_text_content `trackPatch` bodies. */
class ReactiveTextShow {
    static __vmzDirect = true;
    static __vmzState = ['visible', 'label'];
    visible = false;
    label = 'bound label';
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'reactive-text-show');
        const textEl = api.el('p');
        api.attr(textEl, 'data-fixture', 'reactive-text');
        api.trackPatch(this, ['label'], function patchText() {
            textEl.textContent = this.label == null ? '' : String(this.label);
        }, 0);
        rootEl.appendChild(textEl);
        const hiddenEl = api.el('p');
        api.attr(hiddenEl, 'data-fixture', 'reactive-hidden');
        api.trackPatch(this, ['visible'], function patchShow() {
            hiddenEl.style.display = this.visible ? '' : 'none';
        }, 1);
        hiddenEl.appendChild(api.text('hidden body'));
        rootEl.appendChild(hiddenEl);
        return rootEl;
    }
}

const { registerComponents, renderToString, hydrate, flushPending } = await import(domHref);
registerComponents({ StaticTextShow, ReactiveTextShow });

console.log('ssr-text-show: SSR first response carries text and display…');
const staticHtml = await renderToString(StaticTextShow, { props: {} });
if (!staticHtml.includes('>server text</p>')) fail(`SSR static v-text missing text: ${staticHtml}`);
if (!staticHtml.includes('style="color: red; display: none"')) {
    fail(`SSR static v-show missing display: none: ${staticHtml}`);
}

const reactiveHtml = await renderToString(ReactiveTextShow, { props: {} });
if (!reactiveHtml.includes('>bound label</p>')) fail(`SSR reactive v-text missing text: ${reactiveHtml}`);
if (!reactiveHtml.includes('style="display: none"')) {
    fail(`SSR reactive v-show missing display: none: ${reactiveHtml}`);
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

/** Structural snapshot: tag, non-style attributes, inline style, children. */
function snapshot(node) {
    if (node.nodeType === 3) return `#text:${node.textContent}`;
    if (node.nodeType !== 1) return '';
    const attrs = [...node.attributes]
        .filter((a) => a.name !== 'style')
        .map((a) => `${a.name}=${a.value}`)
        .sort();
    const style = node.style ? `display=${node.style.display}|color=${node.style.color}` : '';
    const kids = [...node.childNodes].map(snapshot).filter(Boolean).join(',');
    return `${node.tagName.toLowerCase()}(${attrs.join(';')})[${style}]{${kids}}`;
}

console.log('ssr-text-show: hydrate keeps the server DOM (no mismatch)…');
for (const [Ctor, html, reactiveShow] of [
    [StaticTextShow, staticHtml, false],
    [ReactiveTextShow, reactiveHtml, true],
]) {
    const app = install(html);
    const before = snapshot(app);
    const inst = await hydrate(Ctor, app);
    const after = snapshot(app);
    if (after !== before) {
        fail(`${Ctor.name}: hydration rewrote the SSR DOM\nbefore: ${before}\nafter:  ${after}`);
    }
    if (app.querySelector('[data-fixture$="hidden"]')?.style.display !== 'none') {
        fail(`${Ctor.name}: hidden element lost display:none after hydrate`);
    }
    if (reactiveShow) {
        inst.visible = true;
        await flushPending(inst);
        const hidden = app.querySelector('[data-fixture$="hidden"]');
        if (hidden && hidden.style.display === 'none') fail(`${Ctor.name}: v-show stayed hidden after visible=true`);
    }
}

console.log('ssr-text-show GATE PASS: SSR text/display match hydration');

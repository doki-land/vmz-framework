/**
 * Hydration must keep the option SSR selected by text when `<option>` has no
 * `value` attribute and the template text is indented.
 *
 * `markSelectSelection` compares the trimmed option text, while the client used
 * the IDL `option.value`, which includes template whitespace. A formatted
 * `<option>\n  Beta\n</option>` therefore matched on the server and lost the
 * selection during hydration.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-select-value GATE FAIL: ${msg}`);
    process.exit(1);
}

/** Mirrors emit_direct.rs `<select :value>` + indented `<option>` text. */
class TextOptionSelect {
    static __vmzDirect = true;
    static __vmzState = ['selected'];
    selected = 'Beta';
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        const select = api.el('select');
        api.attr(select, 'data-fixture', 'text-options');
        for (const label of ['Alpha', 'Beta']) {
            const option = api.el('option');
            option.appendChild(api.text(`\n  ${label}\n`));
            select.appendChild(option);
        }
        api.attr(select, 'value', this.selected);
        rootEl.appendChild(select);
        return rootEl;
    }
}

/** Options with an explicit `value` attribute keep exact matching. */
class ValueOptionSelect {
    static __vmzDirect = true;
    static __vmzState = ['selected'];
    selected = 'b';
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        const select = api.el('select');
        api.attr(select, 'data-fixture', 'value-options');
        for (const [value, label] of [
            ['a', 'Alpha'],
            ['b', 'Beta'],
        ]) {
            const option = api.el('option');
            api.attr(option, 'value', value);
            option.appendChild(api.text(`\n  ${label}\n`));
            select.appendChild(option);
        }
        api.attr(select, 'value', this.selected);
        rootEl.appendChild(select);
        return rootEl;
    }
}

const { registerComponents, renderToString, hydrate } = await import(domHref);
registerComponents({ TextOptionSelect, ValueOptionSelect });

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

function selectedLabels(app) {
    return [...app.querySelectorAll('option')].filter((o) => o.selected).map((o) => o.textContent.trim());
}

console.log('ssr-select-value: SSR marks the trimmed text option…');
const textHtml = await renderToString(TextOptionSelect, { props: {} });
if (!/data-fixture="text-options"[\s\S]*<option selected[\s\S]*Beta/.test(textHtml)) {
    fail(`SSR lost the text-option selection: ${textHtml}`);
}
const textDom = install(textHtml);
await hydrate(TextOptionSelect, textDom);
if (selectedLabels(textDom).join(',') !== 'Beta') {
    fail(`hydration changed the selected option: ${selectedLabels(textDom).join(',') || '(none)'}`);
}

console.log('ssr-select-value: explicit `value` attributes still match exactly…');
const valueHtml = await renderToString(ValueOptionSelect, { props: {} });
if (!/data-fixture="value-options"[\s\S]*<option value="b" selected/.test(valueHtml)) {
    fail(`SSR lost the explicit value option: ${valueHtml}`);
}
const valueDom = install(valueHtml);
await hydrate(ValueOptionSelect, valueDom);
if (selectedLabels(valueDom).join(',') !== 'Beta') {
    fail(`hydration broke explicit value selection: ${selectedLabels(valueDom).join(',') || '(none)'}`);
}

console.log('ssr-select-value GATE PASS: SSR and hydrated option selection agree');

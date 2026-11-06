/**
 * A `multiple` select model is a list, not a scalar.
 *
 * `applySerializeAttr` used to `String()` every non-boolean attribute, so
 * `<select multiple :value="['c', 'a']">` became `value="c,a"`. No `<option>`
 * matches that single string, therefore SSR shipped a multiple select with
 * nothing selected while hydration and client create selected both entries.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg: string): never {
    console.error(`ssr-select-multiple GATE FAIL: ${msg}`);
    process.exit(1);
}

class MultipleSelect {
    static __vmzDirect = true;
    static __vmzState = ['picked'];
    picked = ['c', 'a'];
    static __vmzCreate(api: any) {
        const rootEl = api.el('div');
        const select = api.el('select');
        api.attr(select, 'multiple', true);
        for (const value of ['a', 'b', 'c']) {
            const option = api.el('option');
            api.attr(option, 'value', value);
            option.appendChild(api.text(value));
            select.appendChild(option);
        }
        api.attr(select, 'value', this.picked);
        rootEl.appendChild(select);
        return rootEl;
    }
}

const { registerComponents, renderToString, renderToStream, hydrate } = await import(domHref);
registerComponents({ MultipleSelect });

const html = await renderToString(MultipleSelect, { props: {} });
const chunks: string[] = [];
for await (const chunk of renderToStream(MultipleSelect, { props: {} })) chunks.push(chunk);
if (chunks.join('') !== html) fail('streamed and flattened SSR must agree');

if (!html.includes('multiple')) fail(`the select lost its \`multiple\` attribute: ${html}`);

const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
const app = window.document.getElementById('app') as any;
const select = app.firstElementChild.querySelector('select');

const ssrSelected = [...select.querySelectorAll('option')]
    .filter((option: any) => option.hasAttribute('selected'))
    .map((option: any) => option.getAttribute('value'));
if (ssrSelected.join(',') !== 'a,c') {
    fail(`SSR must mark every model entry in document order, got: ${ssrSelected.join(',') || '(none)'} from ${html}`);
}

globalThis.window = window as any;
globalThis.document = window.document as any;
globalThis.HTMLElement = window.HTMLElement as any;
globalThis.Node = window.Node as any;
globalThis.DocumentFragment = window.DocumentFragment as any;
globalThis.Text = window.Text as any;
globalThis.Comment = window.Comment as any;

await hydrate(MultipleSelect, app);
// linkedom does not implement the `multiple` IDL property: its `option.selected`
// setter always clears the siblings, so it can only report the last write. The
// real-browser probe covers the hydrated selection; here we assert that
// hydration does not invent a scalar `value` attribute on the select.
if (select.hasAttribute('value')) {
    fail(`hydration must not mirror a multiple model into a single value attribute: ${select.getAttribute('value')}`);
}

console.log('ssr-select-multiple GATE PASS: SSR marks every model entry in document order');

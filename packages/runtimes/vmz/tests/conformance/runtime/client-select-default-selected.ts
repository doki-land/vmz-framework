/**
 * `form.reset()` restores the option's default state, which browsers derive
 * from the `selected` attribute. The client used to move only `option.selected`,
 * so after hydration every `defaultSelected` was false and a reset cleared the
 * selection instead of returning to the SSR initial option.
 *
 * The first `value` write seeds `selected` on the matching options. Later
 * model updates move only the IDL selectedness.
 *
 * linkedom reflects `option.selected` back onto the attribute and clears the
 * attribute of every sibling on assignment, so the "later update" contract is
 * checked with plain option records that model the browser instead.
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/faces/dom.js')).href;
const attrHref = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/browser/dom/attributes.js')).href;

class SelectDefaults {
    static __vmzDirect = true;
    static __vmzState = ['picked'];
    picked = 'b';
    static __vmzCreate(api: any) {
        const rootEl = api.el('div');
        const select = api.el('select');
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

const { registerComponents, renderToString, hydrate, mount } = await import(domHref);
const { applyDomAttr } = await import(attrHref);
registerComponents({ SelectDefaults });

function byAttribute(select: any) {
    return [...select.querySelectorAll('option')]
        .filter((option: any) => option.hasAttribute('selected'))
        .map((option: any) => option.getAttribute('value'));
}

function fakeSelect(values: string[], multiple = false) {
    const options = values.map((value) => ({
        tagName: 'OPTION',
        value,
        selected: false,
        textContent: value,
        attrs: new Map<string, string>(),
        setAttribute(name: string, v: string) {
            this.attrs.set(name, v);
        },
        removeAttribute(name: string) {
            this.attrs.delete(name);
        },
        hasAttribute(name: string) {
            return this.attrs.has(name);
        },
        getAttribute(name: string) {
            return this.attrs.has(name) ? this.attrs.get(name) : null;
        },
    }));
    return { tagName: 'SELECT', multiple, options };
}

function selectedDefaults(select: any) {
    return select.options
        .filter((option: any) => option.attrs.has('selected'))
        .map((option: any) => option.value);
}

const html = await renderToString(SelectDefaults, { props: {} });

// SSR path: `selected` is the default state the response ships.
{
    const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
    const select = (document.getElementById('app') as any).firstElementChild.firstElementChild;
    assert.deepEqual(byAttribute(select), ['b'], 'SSR must mark the initial option as the default');
}

// Hydration path: the default attribute must survive hydration.
const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div><div id="fresh"></div></body></html>`);
globalThis.window = window as any;
globalThis.document = window.document as any;
globalThis.HTMLElement = window.HTMLElement as any;
globalThis.Node = window.Node as any;
globalThis.DocumentFragment = window.DocumentFragment as any;
globalThis.Text = window.Text as any;
globalThis.Comment = window.Comment as any;

await hydrate(SelectDefaults, window.document.getElementById('app') as any);
const hydratedSelect = window.document.getElementById('app')!.firstElementChild!.firstElementChild!;
assert.deepEqual(byAttribute(hydratedSelect), ['b'], 'hydration must restore the option default attribute');

// Client-only path: the first write seeds the default as well.
const fresh = window.document.getElementById('fresh') as any;
await mount(SelectDefaults, fresh, {});
const clientSelect = fresh.firstElementChild.firstElementChild;
assert.deepEqual(byAttribute(clientSelect), ['b'], 'client create must seed the option default');

// A later model update moves only the IDL selectedness, not the defaults.
const single = fakeSelect(['a', 'b', 'c']);
applyDomAttr(single, 'value', 'b');
assert.deepEqual(selectedDefaults(single), ['b'], 'the first write must seed the selected attribute');
assert.deepEqual(
    single.options.map((option: any) => option.selected),
    [false, true, false],
    'the first write must select the model option',
);

applyDomAttr(single, 'value', 'c');
assert.deepEqual(selectedDefaults(single), ['b'], 'a model update must not move the form-reset target');
assert.deepEqual(
    single.options.map((option: any) => option.selected),
    [false, false, true],
    'a model update must move the visible selection',
);

// A multiple model seeds every default in document order and keeps them.
const multi = fakeSelect(['a', 'b', 'c'], true);
applyDomAttr(multi, 'value', ['c', 'a']);
assert.deepEqual(selectedDefaults(multi), ['a', 'c'], 'a multiple model must seed every default');
applyDomAttr(multi, 'value', ['b']);
assert.deepEqual(selectedDefaults(multi), ['a', 'c'], 'a later multiple update must not move the defaults');
assert.deepEqual(
    multi.options.map((option: any) => option.selected),
    [false, true, false],
    'a later multiple update must move only the visible selection',
);

console.log('client-select-default-selected ok');

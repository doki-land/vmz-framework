/**
 * `form.reset()` restores the default value and default checkedness, which
 * browsers derive from the `value` and `checked` attributes. The client used to
 * rewrite those attributes on every model update, so the defaults followed the
 * model and a reset could never return to the SSR initial state.
 *
 * Only the first write records the defaults. Checkbox and radio `value`
 * attributes are submitted values rather than defaults, so they keep updating.
 */

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const attrHref = pathToFileURL(
    path.join(root, 'packages/runtimes/vmz-runtime/dist/browser/dom/attributes.js'),
).href;
const { applyDomAttr } = await import(attrHref);

function fakeInput(type: string) {
    return {
        tagName: 'INPUT',
        type,
        value: '',
        checked: false,
        attrs: new Map<string, string>(),
        setAttribute(name: string, value: string) {
            this.attrs.set(name, value);
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
    };
}

const text = fakeInput('text');
applyDomAttr(text, 'value', 'a');
assert.equal(text.value, 'a', 'the first write must set the visible value');
assert.equal(text.attrs.get('value'), 'a', 'the first write must seed the defaultValue attribute');

applyDomAttr(text, 'value', 'b');
assert.equal(text.value, 'b', 'later updates must move the visible value');
assert.equal(text.attrs.get('value'), 'a', 'later updates must not move the defaultValue attribute');

const box = fakeInput('checkbox');
applyDomAttr(box, 'checked', true);
assert.equal(box.checked, true, 'the first write must check the control');
assert.equal(box.attrs.get('checked'), '', 'the first write must seed the defaultChecked attribute');

applyDomAttr(box, 'checked', false);
assert.equal(box.checked, false, 'later updates must move the visible checkedness');
assert.equal(box.hasAttribute('checked'), true, 'later updates must not move the defaultChecked attribute');

const radio = fakeInput('radio');
applyDomAttr(radio, 'value', '1');
applyDomAttr(radio, 'value', '2');
assert.equal(radio.attrs.get('value'), '2', 'a checkable value is a submitted value and must follow the model');

const reset = fakeInput('text');
applyDomAttr(reset, 'value', 'x');
applyDomAttr(reset, 'value', null);
assert.equal(reset.value, '', 'a cleared model must clear the visible value');
assert.equal(reset.attrs.get('value'), 'x', 'a cleared model must not erase the defaultValue attribute');

console.log('client-input-default-state ok');

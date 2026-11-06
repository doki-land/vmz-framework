/**
 * A hydrated `<textarea>` must keep its initial default value.
 *
 * SSR ships the initial value as the textarea's text child. Resume parks that
 * child in the adopt pool and only the model write remains, so `defaultValue`
 * (the form-reset target) went empty. The first value write seeds it once and
 * later model updates must not move it.
 */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const attrHref = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/browser/dom/attributes.js')).href;
const { applyDomAttr } = await import(attrHref);

function textarea() {
    return {
        tagName: 'TEXTAREA',
        value: '',
        defaultValue: '',
        attrs: new Map<string, string>(),
        setAttribute(name: string, value: string) {
            this.attrs.set(name, value);
        },
        removeAttribute(name: string) {
            this.attrs.delete(name);
        },
    };
}

const ta = textarea();
applyDomAttr(ta, 'value', 'first\nsecond');
assert.equal(ta.value, 'first\nsecond', 'textarea value must follow the model');
assert.equal(ta.defaultValue, 'first\nsecond', 'the first write must seed the default value');

applyDomAttr(ta, 'value', 'third');
assert.equal(ta.value, 'third', 'later updates must move the visible value');
assert.equal(ta.defaultValue, 'first\nsecond', 'later updates must not move the form-reset target');

const input = { tagName: 'INPUT', value: '', defaultValue: '', setAttribute() {}, removeAttribute() {} };
applyDomAttr(input, 'value', 'x');
assert.equal(input.defaultValue, '', 'only textareas get the one-time default seed');

console.log('client-textarea-default-value ok');

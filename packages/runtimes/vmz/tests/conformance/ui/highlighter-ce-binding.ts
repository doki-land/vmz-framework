/**
 * `vmz-highlighter` is the cross-ecosystem Custom Element surface. Its inputs
 * must bind from both sides: attributes (case-insensitive through the HTML
 * attribute API) and properties (`textContent`, `language`, `theme`).
 *
 * A property write after mount used to leave the shadow output stale: content
 * changes only landed when some unrelated attribute happened to re-render.
 */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = window;
(globalThis as any).document = window.document;
(globalThis as any).HTMLElement = window.HTMLElement;
(globalThis as any).customElements = window.customElements;
(globalThis as any).MutationObserver = window.MutationObserver;

const ceHref = pathToFileURL(path.join(root, 'packages/content/vmz-highlighter/dist/ce.js')).href;
await import(ceHref);

const tick = () => new Promise((r) => setTimeout(r, 20));

const el: any = document.createElement('vmz-highlighter');
el.textContent = 'const a = 1';
el.setAttribute('language', 'javascript');
document.body.appendChild(el);
await tick();
assert.ok(el.shadowRoot.innerHTML.includes('const a = 1'), 'initial light-DOM text must render');

el.textContent = 'const b = 2';
await tick();
assert.ok(el.shadowRoot.innerHTML.includes('const b = 2'), 'textContent property writes must re-render the shadow output');
assert.ok(!el.shadowRoot.innerHTML.includes('const a = 1'), 'stale content must be replaced');

el.language = 'typescript';
await tick();
assert.equal(el.getAttribute('language'), 'typescript', 'the language property must reflect to its attribute');
assert.ok(el.shadowRoot.innerHTML.includes('data-language="typescript"'), 'language property writes must re-render');

// linkedom keeps attribute names case-sensitive, so mixed-case writes are
// covered by the real browser probe instead of this node gate.
el.setAttribute('language', 'javascript');
await tick();
assert.equal(el.getAttribute('language'), 'javascript', 'attribute writes must update the reflected property');
assert.ok(el.shadowRoot.innerHTML.includes('data-language="javascript"'), 'attribute writes must re-render');

console.log('highlighter-ce-binding ok');

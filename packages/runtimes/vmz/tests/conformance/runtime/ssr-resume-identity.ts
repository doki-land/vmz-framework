/**
 * Hydration must reclaim SSR nodes down the whole tree, not only the root element.
 *
 * `runDirectResume` parks `rootEl`'s children into the top-level pool before create.
 * When create adopted `rootEl`, the adopt scope was built from `rootEl.firstChild` —
 * already empty — so every SSR descendant became unreachable and was recreated.
 * Hydration therefore replaced the DOM subtree on each page load: focused elements,
 * caret/selection, typed-but-unbound input state and live CSS animation state were
 * thrown away even though the markup matched.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-resume-identity GATE FAIL: ${msg}`);
    process.exit(1);
}

class NestedTree {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const div = api.el('div');
        api.adoptEnter(div);
        const p = api.el('p');
        api.adoptEnter(p);
        const b = api.el('b');
        api.adoptEnter(b);
        b.appendChild(api.text('client'));
        api.adoptLeave();
        p.appendChild(b);
        api.adoptLeave();
        div.appendChild(p);
        api.adoptLeave();
        return div;
    }
}

const { registerComponents, hydrate } = await import(domHref);
registerComponents({ NestedTree });

const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"><div><p><b>SSR</b></p></div></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;

const app = window.document.getElementById('app');
const ssrDiv = app.firstElementChild;
const ssrP = ssrDiv.firstElementChild;
const ssrB = ssrP.firstElementChild;
const ssrText = ssrB.firstChild;
ssrText.__probe = 'text';

console.log('ssr-resume-identity: hydrate keeps the root + nested SSR elements…');
await hydrate(NestedTree, app);

const div = app.firstElementChild;
const p = div.firstElementChild;
const b = p.firstElementChild;
if (div !== ssrDiv) fail('root element replaced on hydrate');
if (p !== ssrP) fail('nested <p> replaced on hydrate (descendants unreachable in adopt scope)');
if (b !== ssrB) fail('nested <b> replaced on hydrate');
if (b.firstChild !== ssrText) fail('nested text node replaced on hydrate');
if (b.textContent !== 'client') fail(`patched text "${b.textContent}"`);
if (div.children.length !== 1 || p.children.length !== 1 || b.children.length !== 0) {
    fail(`hydrate left orphan siblings: ${app.innerHTML}`);
}

console.log('ssr-resume-identity GATE PASS: hydrate reclaims SSR nodes at every depth');

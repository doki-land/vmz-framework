/**
 * `xlink:href` parsed from SSR HTML lives in the XLink namespace. A plain
 * `setAttribute` writes a non-namespaced attribute, so `<use>` stops resolving
 * the reference after hydration or client create. Client writes must go through
 * `setAttributeNS` and removals through `removeAttributeNS`.
 */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/faces/dom.js')).href;
const attrHref = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/browser/dom/attributes.js')).href;
const { renderToString } = await import(domHref);
const { applyDomAttr } = await import(attrHref);

const XLINK_NS = 'http://www.w3.org/1999/xlink';

const calls: unknown[][] = [];
const el = {
    tagName: 'USE',
    setAttribute(name: string, value: string) {
        calls.push(['attr', name, value]);
    },
    setAttributeNS(ns: string, name: string, value: string) {
        calls.push(['attrNS', ns, name, value]);
    },
    removeAttribute(name: string) {
        calls.push(['remove', name]);
    },
    removeAttributeNS(ns: string, local: string) {
        calls.push(['removeNS', ns, local]);
    },
};

applyDomAttr(el, 'xlink:href', '#icon');
assert.deepEqual(calls, [['attrNS', XLINK_NS, 'xlink:href', '#icon']], 'xlink:href must be written in the XLink namespace');

calls.length = 0;
applyDomAttr(el, 'xlink:href', null);
assert.deepEqual(calls, [['removeNS', XLINK_NS, 'href']], 'xlink:href removal must target the namespaced attribute');

calls.length = 0;
applyDomAttr(el, 'href', '#icon');
assert.deepEqual(calls, [['attr', 'href', '#icon']], 'plain href keeps the ordinary attribute path');

class UseIcon {
    static __vmzDirect = true;
    static __vmzCreate(api: any) {
        const svg = api.el('svg');
        const use = api.el('use');
        api.attr(use, 'xlink:href', '#icon');
        api.attr(use, 'href', '');
        svg.appendChild(use);
        return svg;
    }
}

assert.equal(
    await renderToString(UseIcon),
    '<svg><use xlink:href="#icon" href=""></use></svg>',
    'SSR must serialize xlink:href so the HTML parser namespaces it',
);

console.log('ssr-xlink-namespace ok');

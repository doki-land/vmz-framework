/**
 * class-style-bindings — static + dynamic :class/:style merge (0.1.33).
 * verify id: class-style-bindings
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg: string): never {
    console.error(`class-style-bindings FAIL: ${msg}`);
    process.exit(1);
}

console.log('class-style-bindings: SSR + runtime class/style merge…');
const { registerComponents, renderToString, mergeClassParts } = await import(domHref);

class ClassStyleFixture {
    static __vmzDirect = true;
    gameRootClass = '';
    rowClass = '';
    lockFillStyle = 'width: 0%';
    overloadOn = false;

    static __vmzCreate(api) {
        const root = api.el('div');
        api.attr(root, 'class', api.mergeClass('game theme-fixture', this.gameRootClass, this.overloadOn && 'boost'));
        const gauge = api.el('div');
        api.attr(gauge, 'class', api.mergeClass('gauge heat', this.overloadOn && 'alarm'));
        root.appendChild(gauge);
        const lock = api.el('div');
        api.attr(lock, 'class', 'lock-fill');
        api.attr(lock, 'style', api.mergeStyle('opacity: 1', this.lockFillStyle));
        root.appendChild(lock);
        const btn = api.el('button');
        api.attr(btn, 'class', api.mergeClass('bp-build', { ready: this.rowClass === 'ready' }));
        root.appendChild(btn);
        return root;
    }
}

registerComponents({ ClassStyleFixture });

const html = await renderToString(ClassStyleFixture, { props: {} });
if (html.includes('[object Object]')) fail(`SSR leaked [object Object]: ${html.slice(0, 500)}`);
if (!html.includes('class="game theme-fixture"')) fail(`missing static theme class: ${html.slice(0, 500)}`);
if (!html.includes('class="gauge heat"')) fail(`missing gauge base class: ${html.slice(0, 500)}`);
if (!html.includes('class="bp-build"')) fail(`missing shop button base class: ${html.slice(0, 500)}`);
if (!html.includes('style="opacity: 1; width: 0%"')) fail(`merged style missing: ${html.slice(0, 500)}`);

if (mergeClassParts('a b', { c: true }, null, false) !== 'a b c') {
    fail('mergeClassParts object/array contract broken');
}
if (mergeClassParts('game theme-x', '') !== 'game theme-x') {
    fail('empty dynamic must not drop static tokens');
}

console.log('class-style-bindings PASS');

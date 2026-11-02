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
const { registerComponents, renderToString, mergeClassParts, mergeStyleParts } = await import(domHref);

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

/** `:style` object binding (lights-out board shape): camelCase keys + number + custom prop. */
class StyleObjectFixture {
    static __vmzDirect = true;
    boardStyle = {
        gridTemplateColumns: 'repeat(3, 2.5rem)',
        width: 400,
        zIndex: 2,
        '--accent': '#f59e0b',
    };

    static __vmzCreate(api) {
        const root = api.el('div');
        api.attr(root, 'class', 'board');
        api.attr(root, 'style', api.mergeStyle(this.boardStyle));
        return root;
    }
}

registerComponents({ ClassStyleFixture, StyleObjectFixture });

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

// --- style object binding normalization: SSR text must be valid CSS spelling ---
const styleHtml = await renderToString(StyleObjectFixture, { props: {} });
if (styleHtml.includes('gridTemplateColumns')) {
    fail(`SSR style attribute kept camelCase key: ${styleHtml.slice(0, 500)}`);
}
if (
    !styleHtml.includes(
        'style="grid-template-columns: repeat(3, 2.5rem); width: 400px; z-index: 2; --accent: #f59e0b"',
    )
) {
    fail(`SSR style attribute not normalized: ${styleHtml.slice(0, 500)}`);
}

const styleCases: Array<[unknown[], string]> = [
    // camelCase → kebab-case
    [[{ gridTemplateColumns: 'repeat(3, 2.5rem)' }], 'grid-template-columns: repeat(3, 2.5rem)'],
    [[{ webkitLineClamp: 3 }], 'webkit-line-clamp: 3'],
    // already kebab stays untouched
    [[{ 'grid-template-columns': '1fr' }], 'grid-template-columns: 1fr'],
    // numeric values: px for sized properties, unitless list stays bare, 0 stays bare
    [[{ width: 400 }], 'width: 400px'],
    [[{ zIndex: 2, opacity: 0.5 }], 'z-index: 2; opacity: 0.5'],
    [[{ margin: 0 }], 'margin: 0'],
    // strings with explicit units pass through
    [[{ width: '2.5rem', gap: '0.35rem' }], 'width: 2.5rem; gap: 0.35rem'],
    // custom properties preserved verbatim, numeric custom props stay unitless
    [[{ '--accent': '#f59e0b', '--cols': 3 }], '--accent: #f59e0b; --cols: 3'],
    // null / undefined / false drop the declaration
    [[{ gap: null, color: undefined, display: false, width: '1px' }], 'width: 1px'],
    // array values emit repeated declarations, nested arrays flatten
    [[{ display: ['-webkit-box', 'flex'] }], 'display: -webkit-box; display: flex'],
    [[{ display: [['-webkit-box'], ['-ms-flexbox', 'flex']] }], 'display: -webkit-box; display: -ms-flexbox; display: flex'],
    // top-level arrays merge in order and later parts override by normalized key
    [[{ color: 'red' }, ['margin: 1px', { color: 'blue' }]], 'color: blue; margin: 1px'],
    [['grid-template-columns: 1fr', { gridTemplateColumns: '2fr' }], 'grid-template-columns: 2fr'],
    // illegal property names are dropped like the browser drops invalid declarations
    [[{ 'bad key': 'x', 'semi;colon': 'y', '1digit': 'z', width: '2px' }], 'width: 2px'],
];
for (const [input, expected] of styleCases) {
    const actual = mergeStyleParts(...input);
    if (actual !== expected) fail(`mergeStyleParts(${JSON.stringify(input)}) = ${actual}, want ${expected}`);
}

console.log('class-style-bindings PASS');

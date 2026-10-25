/**
 * ssr-svg-region-slot — SSR must project default slots through if-root fragments
 * and emit SVG-safe region hosts (g, not span) for v-if inside <svg>.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';
import { createDirectIfBlock } from '../_lib/direct-inline-if.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg: string) {
    console.error(`ssr-svg-region-slot FAIL: ${msg}`);
    process.exit(1);
}

const { registerComponents, renderToString } = await import(domHref);

class IfRootButton {
    static __vmzDirect = true;
    static __vmzHostBox = 'contents';
    static __vmzState = ['href'];
    href = '';
    static __vmzCreate(api: {
        component: (inst: unknown, name: string, props: object, client: null) => unknown;
        adoptEnter: (host: unknown) => void;
        adoptLeave: () => void;
        projectDefaultSlot: (host: unknown, node: unknown) => void;
        el: (tag: string) => unknown;
        attr: (el: unknown, name: string, value: unknown) => void;
        text: (value: string) => unknown;
        frag: () => { appendChild: (c: unknown) => void };
    }) {
        return createDirectIfBlock(
            api,
            this,
            ['href'],
            [
                {
                    cond: function () {
                        return this.href;
                    },
                    create: (api) => {
                        const a = api.el('a');
                        api.attr(a, 'class', 'vmz-ui-btn');
                        const slot = api.el('slot');
                        (a as { appendChild: (c: unknown) => void }).appendChild(slot);
                        return a;
                    },
                },
                {
                    create: (api) => {
                        const btn = api.el('button');
                        api.attr(btn, 'type', 'button');
                        api.attr(btn, 'class', 'vmz-ui-btn');
                        const slot = api.el('slot');
                        (btn as { appendChild: (c: unknown) => void }).appendChild(slot);
                        return btn;
                    },
                },
            ],
            null,
            1,
        );
    }
}

class IfRootButtonPage {
    static __vmzDirect = true;
    static __vmzCreate(api: {
        el: (tag: string) => unknown;
        attr: (el: unknown, name: string, value: unknown) => void;
        component: (inst: unknown, name: string, props: object, client: null) => unknown;
        adoptEnter: (host: unknown) => void;
        adoptLeave: () => void;
        projectDefaultSlot: (host: unknown, node: unknown) => void;
        text: (value: string) => unknown;
    }) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'ssr-slot-page');
        const host = api.component(this, 'IfRootButton', {}, null);
        api.adoptEnter(host);
        api.projectDefaultSlot(host, api.text('Save'));
        api.adoptLeave();
        (rootEl as { appendChild: (c: unknown) => void }).appendChild(host);
        return rootEl;
    }
}

class SvgIconPage {
    static __vmzDirect = true;
    static __vmzState = ['resolvedPath'];
    resolvedPath = 'M12 2 4 14h7l-1 8 10-14h-7l0-6z';
    static __vmzCreate(api: {
        el: (tag: string) => unknown;
        attr: (el: unknown, name: string, value: unknown) => void;
        specFieldAttr: (inst: unknown, id: number, field: string, el: unknown, name: string) => void;
        frag: () => { appendChild: (c: unknown) => void };
    }) {
        const wrap = api.el('span');
        api.attr(wrap, 'data-fixture', 'ssr-svg-icon');
        const svg = api.el('svg');
        api.attr(svg, 'viewBox', '0 0 24 24');
        const block = createDirectIfBlock(
            api,
            this,
            ['resolvedPath'],
            [
                {
                    cond: function () {
                        return this.resolvedPath;
                    },
                    create: (api) => {
                        const path = api.el('path');
                        api.attr(path, 'fill', 'currentColor');
                        api.specFieldAttr(this, 0, 'resolvedPath', path, 'd');
                        return path;
                    },
                },
            ],
            null,
            2,
        );
        (svg as { appendChild: (c: unknown) => void }).appendChild(block);
        (wrap as { appendChild: (c: unknown) => void }).appendChild(svg);
        return wrap;
    }
}

registerComponents({ IfRootButton, IfRootButtonPage, SvgIconPage });

console.log('ssr-svg-region-slot: if-root Button slot SSR…');
const htmlBtn = await renderToString(IfRootButtonPage, { props: {} });
const btnMatch = htmlBtn.match(/<button[^>]*>([\s\S]*?)<\/button>/);
if (!btnMatch || !btnMatch[1].includes('Save')) {
    fail(`SSR Button label must render inside <button>: ${htmlBtn}`);
}
if (/<\/button>\s*Save/.test(htmlBtn)) {
    fail(`SSR Button label leaked outside <button>: ${htmlBtn}`);
}

console.log('ssr-svg-region-slot: SVG region host + path SSR…');
const htmlSvg = await renderToString(SvgIconPage, { props: {} });
if (!htmlSvg.includes('<path')) fail(`SSR SVG icon missing <path>: ${htmlSvg}`);
if (/<svg[\s\S]*<span[^>]*data-vmz-region/.test(htmlSvg)) {
    fail(`SSR SVG icon must not use HTML <span> region host inside <svg>: ${htmlSvg}`);
}
if (!/<svg[\s\S]*<path[^>]*\bd=/.test(htmlSvg)) {
    fail(`SSR SVG icon missing path d attribute: ${htmlSvg}`);
}

parseHTML('<!DOCTYPE html><html><body></body></html>');
console.log('ssr-svg-region-slot PASS');

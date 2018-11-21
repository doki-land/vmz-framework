/**
 * ssr-unknown-component-error-node — unknown Direct leaf → error node; page stays 200.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(`ssr-unknown-component-error-node GATE FAIL: ${msg}`);
    process.exit(1);
}

const distDom = path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'dom.js');
const distUnknown = path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'unknown-component.js');
if (!fs.existsSync(distDom) || !fs.existsSync(distUnknown)) {
    fail('missing @vmz/core dist — run pnpm --filter @vmz/core build');
}

const { UNKNOWN_COMPONENT_ERROR } = await import(pathToFileURL(distUnknown).href);
const { registerComponents, renderToString } = await import(pathToFileURL(distDom).href);

console.log('ssr-unknown-component-error-node: fixture with MissingThing…');

class OkParagraph {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const p = api.el('p');
        p.appendChild(api.text('Hello'));
        return p;
    }
}

registerComponents({ OkParagraph });

class Page {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const root = api.el('div');
        api.attr(root, 'data-vmz-fixture', 'unknown-component');
        root.appendChild(api.component(Page, 'MissingThing', {}, null));
        root.appendChild(api.component(Page, 'OkParagraph', {}, null));
        return root;
    }
}

let threw = false;
let html = '';
try {
    html = await renderToString(Page, {});
} catch (e) {
    threw = true;
    fail(`renderToString must not throw on unknown leaf: ${e instanceof Error ? e.message : String(e)}`);
}
if (threw) fail('unexpected throw');

if (!html.includes('Hello')) fail(`page body must continue after unknown leaf: ${html.slice(0, 500)}`);
if (!html.includes(`data-vmz-error="${UNKNOWN_COMPONENT_ERROR}"`) && !html.includes("data-vmz-error='unknown-component'")) {
    fail(`missing unknown-component error node: ${html.slice(0, 500)}`);
}
if (!html.includes('data-vmz-component="MissingThing"') && !html.includes("data-vmz-component='MissingThing'")) {
    fail(`missing data-vmz-component=MissingThing: ${html.slice(0, 500)}`);
}
if (html.includes('data-vmz="MissingThing"') && !html.includes('data-vmz-error')) {
    fail('unknown leaf must not look like a healthy host without error marker');
}

console.log('ssr-unknown-component-error-node: healthy page has no error node…');

class Healthy {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const root = api.el('div');
        root.appendChild(api.component(Healthy, 'OkParagraph', {}, null));
        return root;
    }
}

const healthy = await renderToString(Healthy, {});
if (!healthy.includes('Hello')) fail('healthy page missing Hello');
if (healthy.includes('data-vmz-error')) fail(`healthy page must not emit error node: ${healthy.slice(0, 400)}`);

console.log('ssr-unknown-component-error-node PASS');

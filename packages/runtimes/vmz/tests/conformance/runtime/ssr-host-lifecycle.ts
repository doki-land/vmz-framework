/**
 * ssr-host-lifecycle — I-07 host lifecycle contract.
 *
 * Contract: `onMount` runs once during SSR against a host-provided document.
 * The SSR host provides `document` only — it never injects a `window` shim and
 * never fabricates a browser `location` / origin. `typeof window === "undefined"`
 * is therefore the honest SSR signal. The documented double guard
 * (`typeof window === "undefined" || !window.location`) stays valid for hosts
 * that do supply a real window (client lifecycle).
 *
 * This check reproduces the failure of an unguarded read, proves the honest
 * `typeof window` signal, proves the documented guards work, and proves the
 * same author code resolves a real location when the host supplies one.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(`ssr-host-lifecycle GATE FAIL: ${msg}`);
    process.exit(1);
}

const domHref = pathToFileURL(
    path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js'),
).href;
const { registerComponents, renderToString } = await import(domHref);

function probe(tag, readPath) {
    return class {
        static __vmzDirect = true;
        path = 'unset';
        static __vmzCreate(api) {
            const el = api.el('p');
            api.attr(el, 'data-probe', tag);
            api.attr(el, 'data-path', this.path);
            el.appendChild(api.text(this.path));
            return el;
        }
        async onMount() {
            this.path = readPath();
        }
    };
}

let mountCalls = 0;
class Counting {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const el = api.el('p');
        api.attr(el, 'data-count', String(mountCalls));
        return el;
    }
    async onMount() {
        mountCalls += 1;
    }
}

const readUnguarded = () => globalThis.window.location.pathname;
const readSingleGuard = () => (typeof window === 'undefined' ? '/' : window.location.pathname);
const readGuarded = () => {
    if (typeof window === 'undefined' || !window.location) return '/';
    return window.location.pathname;
};

const Unguarded = probe('unguarded', readUnguarded);
const SingleGuarded = probe('single-guard', readSingleGuard);
const Guarded = probe('guarded', readGuarded);
registerComponents({ Unguarded, SingleGuarded, Guarded, Counting });

console.log('ssr-host-lifecycle: onMount runs once during SSR…');
await renderToString(Counting, {});
if (mountCalls !== 1) fail(`onMount must run exactly once during SSR, ran ${mountCalls} time(s)`);

console.log('ssr-host-lifecycle: SSR host provides a document but no browser window…');
if (typeof globalThis.document === 'undefined' || typeof globalThis.document.createElement !== 'function') {
    fail('SSR host must provide a document for component DOM work');
}
if (globalThis.window !== undefined) {
    fail('SSR host must not inject a `window` shim: `typeof window` must stay undefined on the server');
}

console.log('ssr-host-lifecycle: reproduces unguarded `window.location` failure…');
let unguardedError = null;
try {
    await renderToString(Unguarded, {});
} catch (error) {
    unguardedError = error;
}
if (!(unguardedError instanceof TypeError)) {
    fail(`unguarded window.location must throw a TypeError in SSR, got: ${String(unguardedError)}`);
}
if (! /location/.test(unguardedError.message)) {
    fail(`unexpected reproduction error: ${unguardedError.message}`);
}

console.log('ssr-host-lifecycle: single `typeof window` guard renders the SSR fallback…');
const singleSsr = await renderToString(SingleGuarded, {});
if (!singleSsr.includes('data-path="/"')) {
    fail(`single typeof window guard must use the "/" fallback, got: ${singleSsr.slice(0, 300)}`);
}

console.log('ssr-host-lifecycle: documented double guard renders the SSR fallback…');
const guardedSsr = await renderToString(Guarded, {});
if (!guardedSsr.includes('data-path="/"')) {
    fail(`guarded SSR read must use the "/" fallback, got: ${guardedSsr.slice(0, 300)}`);
}

console.log('ssr-host-lifecycle: the same author code resolves a host-provided location…');
globalThis.window = { location: { pathname: '/docs/getting-started' } };
const singleClient = await renderToString(SingleGuarded, {});
if (!singleClient.includes('data-path="/docs/getting-started"')) {
    fail(`single guard must resolve the host location, got: ${singleClient.slice(0, 300)}`);
}
const guardedClient = await renderToString(Guarded, {});
if (!guardedClient.includes('data-path="/docs/getting-started"')) {
    fail(`guarded read must resolve the host location, got: ${guardedClient.slice(0, 300)}`);
}

console.log('ssr-host-lifecycle GATE PASS: SSR onMount has document but no browser window/location');

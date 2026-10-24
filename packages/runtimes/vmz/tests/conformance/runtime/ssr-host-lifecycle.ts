/**
 * ssr-host-lifecycle — I-07 minimal reproduction.
 *
 * Contract: `onMount` runs once during SSR against a host-provided document.
 * The SSR host has no browser URL/location, even though a `window` shim may
 * exist. This check reproduces the failure of an unguarded read, proves the
 * documented guard works, and proves the same author code resolves a real
 * location when the host supplies one (client lifecycle).
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
const readGuarded = () => {
    if (typeof window === 'undefined' || !window.location) return '/';
    return window.location.pathname;
};

const Unguarded = probe('unguarded', readUnguarded);
const Guarded = probe('guarded', readGuarded);
registerComponents({ Unguarded, Guarded, Counting });

console.log('ssr-host-lifecycle: onMount runs once during SSR…');
await renderToString(Counting, {});
if (mountCalls !== 1) fail(`onMount must run exactly once during SSR, ran ${mountCalls} time(s)`);
if (typeof globalThis.document === 'undefined' || typeof globalThis.document.createElement !== 'function') {
    fail('SSR host must provide a document for component DOM work');
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
if (! /pathname/.test(unguardedError.message)) {
    fail(`unexpected reproduction error: ${unguardedError.message}`);
}
if (globalThis.window.location !== undefined) {
    fail('SSR window shim unexpectedly exposes a browser location');
}

console.log('ssr-host-lifecycle: guarded read renders the SSR fallback…');
const guardedSsr = await renderToString(Guarded, {});
if (!guardedSsr.includes('data-path="/"')) {
    fail(`guarded SSR read must use the "/" fallback, got: ${guardedSsr.slice(0, 300)}`);
}

console.log('ssr-host-lifecycle: same author code resolves a host-provided location…');
Object.defineProperty(globalThis.window, 'location', {
    value: { pathname: '/docs/getting-started' },
    configurable: true,
});
const guardedClient = await renderToString(Guarded, {});
if (!guardedClient.includes('data-path="/docs/getting-started"')) {
    fail(`guarded read must resolve the host location, got: ${guardedClient.slice(0, 300)}`);
}

console.log('ssr-host-lifecycle GATE PASS: SSR onMount has no implicit browser location');

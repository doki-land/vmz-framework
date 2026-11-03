/**
 * ssr-onmount-budget — SSR `onMount` execution budget contract.
 *
 * Contract: every per-instance `onMount` await during SSR is bounded (default
 * 5000ms, overridable via `opts.onMountBudgetMs`). Budget exhaustion and host
 * `signal` abort are the same event: the render terminates and fails with a
 * diagnostic naming the component, the budget and the elapsed time — no
 * half-baked HTML, no silent empty string, no retry. A fast `onMount` is never
 * killed. `static-emit` and the request-time serve host share one path: both
 * render through `createRenderHost`, whose `renderToString` / `renderToStream`
 * are the dom face functions tested here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(`ssr-onmount-budget GATE FAIL: ${msg}`);
    process.exit(1);
}

const domHref = pathToFileURL(
    path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js'),
).href;
const renderHostHref = pathToFileURL(
    path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'host', 'render', 'render-host.js'),
).href;
const { registerComponents, renderToString, renderToStream } = await import(domHref);
const { createRenderHost } = await import(renderHostHref);

function directClass(name, create) {
    return { [name]: class {
        static __vmzDirect = true;
        static __vmzCreate = create;
    } }[name];
}

const QuickMount = directClass('QuickMount', function (api) {
    const el = api.el('p');
    el.appendChild(api.text(this.label || 'unset'));
    return el;
});
QuickMount.prototype.label = 'unset';
QuickMount.prototype.onMount = async function () {
    await new Promise((r) => setTimeout(r, 10));
    this.label = 'mounted';
};

const HangMount = directClass('HangMount', function (api) {
    const el = api.el('p');
    el.appendChild(api.text('hang'));
    return el;
});
HangMount.prototype.onMount = function () {
    return new Promise(() => {});
};

const HangChild = directClass('HangChild', function (api) {
    const el = api.el('span');
    el.appendChild(api.text('hang-child'));
    return el;
});
HangChild.prototype.onMount = function () {
    return new Promise(() => {});
};

const ParentOfHang = directClass('ParentOfHang', function (api) {
    const host = api.component(this, 'HangChild', {});
    return host;
});

const ThrowMount = directClass('ThrowMount', function (api) {
    const el = api.el('p');
    el.appendChild(api.text('throw'));
    return el;
});
ThrowMount.prototype.onMount = function () {
    throw new Error('author boom');
};

const SlowMount = directClass('SlowMount', function (api) {
    const el = api.el('p');
    el.appendChild(api.text('slow'));
    return el;
});
SlowMount.prototype.onMount = function () {
    return new Promise((r) => setTimeout(r, 500));
};

registerComponents({ QuickMount, HangMount, HangChild, ParentOfHang, ThrowMount, SlowMount });

console.log('ssr-onmount-budget: fast onMount under a small budget renders (no false kill)…');
const quick = await renderToString(QuickMount, {}, { onMountBudgetMs: 200 });
if (!quick.includes('mounted')) fail(`fast onMount must complete under budget, got: ${quick.slice(0, 200)}`);

console.log('ssr-onmount-budget: default budget renders a fast onMount…');
const quickDefault = await renderToString(QuickMount, {});
if (!quickDefault.includes('mounted')) fail(`default budget render broke: ${quickDefault.slice(0, 200)}`);

console.log('ssr-onmount-budget: hung onMount fails inside the budget with a readable diagnostic…');
{
    const startedAt = Date.now();
    let err = null;
    try {
        await renderToString(HangMount, {}, { onMountBudgetMs: 50 });
    } catch (error) {
        err = error;
    }
    const elapsed = Date.now() - startedAt;
    if (!err) fail('hung onMount must reject, not resolve');
    if (err.name !== 'SsrOnMountTimeoutError') fail(`expected SsrOnMountTimeoutError, got ${err.name}: ${err.message}`);
    if (!err.message.includes('component=HangMount')) fail(`diagnostic must name the component: ${err.message}`);
    if (!err.message.includes('budget=50ms')) fail(`diagnostic must carry the budget: ${err.message}`);
    if (!/elapsed=\d+ms/.test(err.message)) fail(`diagnostic must carry elapsed time: ${err.message}`);
    if (elapsed > 2000) fail(`budget must bound the await, took ${elapsed}ms`);
}

console.log('ssr-onmount-budget: hung child onMount (nested mounts path) fails the same way…');
{
    let err = null;
    try {
        await renderToString(ParentOfHang, {}, { onMountBudgetMs: 50 });
    } catch (error) {
        err = error;
    }
    if (!err || err.name !== 'SsrOnMountTimeoutError') {
        fail(`nested hung onMount must reject with SsrOnMountTimeoutError, got: ${err && err.message}`);
    }
    if (!err.message.includes('component=HangChild')) fail(`diagnostic must name the child: ${err.message}`);
}

console.log('ssr-onmount-budget: author throw propagates unchanged…');
{
    let err = null;
    try {
        await renderToString(ThrowMount, {}, { onMountBudgetMs: 50 });
    } catch (error) {
        err = error;
    }
    if (!err || err.message !== 'author boom') fail(`author error must propagate as-is, got: ${err && err.message}`);
}

console.log('ssr-onmount-budget: host signal abort interrupts the onMount await…');
{
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    let err = null;
    try {
        await renderToString(SlowMount, {}, { signal: ac.signal, onMountBudgetMs: 5000 });
    } catch (error) {
        err = error;
    }
    if (!err || err.name !== 'SsrRenderAbortError') {
        fail(`abort during onMount must reject with SsrRenderAbortError, got: ${err && err.name}: ${err && err.message}`);
    }
    if (!err.message.includes('component=SlowMount')) fail(`abort diagnostic must name the component: ${err.message}`);
}

console.log('ssr-onmount-budget: renderToStream applies the same budget…');
{
    let err = null;
    try {
        for await (const chunk of renderToStream(HangMount, {}, { onMountBudgetMs: 50 })) {
            void chunk;
        }
    } catch (error) {
        err = error;
    }
    if (!err || err.name !== 'SsrOnMountTimeoutError') {
        fail(`stream render must reject with SsrOnMountTimeoutError, got: ${err && err.message}`);
    }
}

console.log('ssr-onmount-budget: createRenderHost (static-emit / serve-host shared path) enforces the budget…');
{
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ssr-budget-host-'));
    try {
        fs.writeFileSync(path.join(fixture, 'vmz-dom.js'), `export * from ${JSON.stringify(domHref)};\n`, 'utf8');
        const host = await createRenderHost(fixture, { strictDeployment: false, preload: 'none' });
        let err = null;
        try {
            await host.renderToString(HangMount, {}, { onMountBudgetMs: 50 });
        } catch (error) {
            err = error;
        }
        if (!err || err.name !== 'SsrOnMountTimeoutError') {
            fail(`host render path must reject with SsrOnMountTimeoutError, got: ${err && err.message}`);
        }
        if (!err.message.includes('component=HangMount')) fail(`host diagnostic must name the component: ${err.message}`);
    } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
    }
}

console.log('ssr-onmount-budget GATE PASS: SSR onMount is bounded, abortable and fails readably');

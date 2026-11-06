/**
 * ssr-route-slot-layout — a pass-through `<slot/>` layout must not wipe the SSR route.
 *
 * `hydrateRoute` mounts each layout before hydrating the page. A layout whose whole
 * template is a default slot renders no DOM of its own (SSR puts the page straight
 * into the route container), so mounting it clears the SSR tree and every page node
 * is recreated. The transparent-layout fast path must hydrate in place instead,
 * while wrapper layouts and stateful slot layouts keep the mount path.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg) {
    console.error(`ssr-route-slot-layout GATE FAIL: ${msg}`);
    process.exit(1);
}

function installDom(window) {
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;
}

function collect(node) {
    const out = [];
    const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 || c.nodeType === 3) out.push(c);
            if (c.nodeType === 1) walk(c);
        }
    };
    walk(node);
    return out;
}

const { registerComponents, renderToString, hydrateRoute } = await import(domHref);

/** Page shape: root div > p > b(text), plus a button (element + text identity). */
class RoutePage {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'route-page');
        api.adoptEnter(rootEl);
        const p = api.el('p');
        api.attr(p, 'data-fixture', 'route-p');
        api.adoptEnter(p);
        const b = api.el('b');
        api.attr(b, 'data-fixture', 'route-b');
        api.adoptEnter(b);
        b.appendChild(api.text('route copy'));
        api.adoptLeave();
        p.appendChild(b);
        api.adoptLeave();
        rootEl.appendChild(p);
        const btn = api.el('button');
        api.attr(btn, 'type', 'button');
        api.attr(btn, 'data-fixture', 'route-btn');
        api.adoptEnter(btn);
        btn.appendChild(api.text('act'));
        api.adoptLeave();
        rootEl.appendChild(btn);
        api.adoptLeave();
        return rootEl;
    }
}

function slotPlan() {
    return {
        schema: 'vmz.plan.v0',
        status: 'partial',
        root_ids: [0],
        nodes: [{ kind: 'slot', id: 0, tag: 'slot', projection_id: 0 }],
    };
}

/** Pass-through layout: exactly what `Application.vmz` (`<template><slot/></template>`) emits. */
class TransparentLayout {
    static __vmzDirect = true;
    static __vmzPlan = slotPlan();
    static __vmzState = [];
    static __vmzProps = [];
    static __vmzCreate(api) {
        const slot = api.el('slot');
        api.adoptEnter(slot);
        api.adoptLeave();
        return slot;
    }
}

/** Wrapper layout keeps its own DOM: the fast path must not apply. */
class WrappedLayout {
    static __vmzDirect = true;
    static __vmzPlan = {
        schema: 'vmz.plan.v0',
        status: 'partial',
        root_ids: [0],
        nodes: [{ kind: 'element', id: 0, tag: 'div' }],
    };
    static __vmzState = [];
    static __vmzProps = [];
    static __vmzCreate(api) {
        const shell = api.el('div');
        api.attr(shell, 'data-fixture', 'layout-shell');
        const slot = api.el('slot');
        shell.appendChild(slot);
        return shell;
    }
}

/** Slot-only but stateful: must keep the mount path (its instance has work to do). */
class StatefulSlotLayout {
    static __vmzDirect = true;
    static __vmzPlan = slotPlan();
    static __vmzState = ['ready'];
    static __vmzProps = [];
    ready = false;
    static __vmzCreate(api) {
        const slot = api.el('slot');
        api.adoptEnter(slot);
        api.adoptLeave();
        return slot;
    }
}

registerComponents({ RoutePage, TransparentLayout, WrappedLayout, StatefulSlotLayout });

const pageHtml = await renderToString(RoutePage, { props: {} });
if (!pageHtml.includes('data-fixture="route-p"')) fail(`SSR page missing p: ${pageHtml}`);

// 1. Transparent layout: hydrate in place, keep every SSR node.
{
    const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${pageHtml}</div></body></html>`);
    installDom(window);
    const app = window.document.getElementById('app');
    const ssrRoot = app.firstElementChild;
    const ssrP = app.querySelector('[data-fixture="route-p"]');
    const ssrB = app.querySelector('[data-fixture="route-b"]');
    const before = collect(app);
    const seen = new WeakSet(before);

    const inst = await hydrateRoute(RoutePage, app, {}, [TransparentLayout]);
    if (inst !== app.__vmzInst) fail('page instance is not the route container owner');
    if (!Array.isArray(app.__vmzLayoutInsts) || app.__vmzLayoutInsts.length !== 0) {
        fail(`transparent layout left a layout instance: ${JSON.stringify(app.__vmzLayoutInsts)}`);
    }
    if (app.firstElementChild !== ssrRoot) fail('route page root was recreated instead of adopted');
    if (app.querySelector('[data-fixture="route-p"]') !== ssrP) fail('nested <p> was recreated instead of adopted');
    if (app.querySelector('[data-fixture="route-b"]') !== ssrB) fail('nested <b> was recreated instead of adopted');
    const fresh = collect(app).filter((n) => !seen.has(n));
    if (fresh.length) fail(`transparent layout still created ${fresh.length} node(s) on hydrate`);
    if (!app.querySelector('[data-fixture="route-btn"]')) fail('page button lost after in-place hydrate');
    console.log('ssr-route-slot-layout: transparent layout reclaimed all SSR nodes');
}

// 2. Wrapper layout: mount path stays, its own shell is rebuilt around a fresh page.
{
    const { window } = parseHTML(
        `<!DOCTYPE html><html><body><div id="app"><div data-fixture="layout-shell">${pageHtml}</div></div></body></html>`,
    );
    installDom(window);
    const app = window.document.getElementById('app');
    const ssrShell = app.querySelector('[data-fixture="layout-shell"]');
    const inst = await hydrateRoute(RoutePage, app, {}, [WrappedLayout]);
    if (!Array.isArray(app.__vmzLayoutInsts) || app.__vmzLayoutInsts.length !== 1) {
        fail('wrapper layout was skipped: layout instance missing');
    }
    const shell = app.querySelector('[data-fixture="layout-shell"]');
    if (!shell) fail('wrapper layout shell missing after mount');
    if (shell === ssrShell) fail('wrapper layout reused SSR shell, but mount path is expected to rebuild');
    if (app.__vmzInst !== app.__vmzLayoutInsts[0]) fail('wrapper layout must own the #app instance');
    if (inst === app.__vmzInst) fail('wrapper layout must not hand #app to the page instance');
    if (!app.querySelector('[data-fixture="route-p"]')) fail('page missing inside wrapper outlet');
    console.log('ssr-route-slot-layout: wrapper layout still mounts as before');
}

// 3. Stateful slot layout: conservative guard keeps it mounted.
{
    const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${pageHtml}</div></body></html>`);
    installDom(window);
    const app = window.document.getElementById('app');
    const inst = await hydrateRoute(RoutePage, app, {}, [StatefulSlotLayout]);
    if (!Array.isArray(app.__vmzLayoutInsts) || app.__vmzLayoutInsts.length !== 1) {
        fail('stateful slot layout was skipped: its instance/state never ran');
    }
    if (app.__vmzInst !== app.__vmzLayoutInsts[0]) fail('stateful layout must own the #app instance');
    if (inst === app.__vmzInst) fail('stateful layout must not hand #app to the page instance');
    if (!app.querySelector('[data-fixture="route-p"]')) fail('page missing under stateful slot layout');
    console.log('ssr-route-slot-layout: stateful slot layout keeps the mount path');
}

console.log('ssr-route-slot-layout GATE PASS: pass-through layouts hydrate the SSR route in place');

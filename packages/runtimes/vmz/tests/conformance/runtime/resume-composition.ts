/**
 * resume-composition — SSR hydrate/resume must not let ifBlock steal parent siblings.
 *
 * Reproduces the commercial debt: Card-like parent with v-if/v-else plus a sibling
 * host after the if. After resume, toggling the branch must leave the sibling alive
 * and interactive.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'dom.js')).href;

function fail(msg) {
    console.error(`resume-composition GATE FAIL: ${msg}`);
    process.exit(1);
}

const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Text = window.Text;
globalThis.Comment = window.Comment;

const { registerComponents, renderToString, hydrate, flushPending } = await import(domHref);

class SiblingHost {
    static __vmzDirect = true;
    static __vmzState = ['clicks'];
    clicks = 0;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'sibling-host');
        const btn = api.el('button');
        api.attr(btn, 'type', 'button');
        api.attr(btn, 'data-fixture', 'sibling-btn');
        btn.appendChild(api.text('Sibling action'));
        api.on(btn, 'click', function () {
            this.clicks = (this.clicks || 0) + 1;
            const out = rootEl.querySelector('[data-fixture="sibling-count"]');
            if (out) out.textContent = String(this.clicks);
        });
        rootEl.appendChild(btn);
        const count = api.el('span');
        api.attr(count, 'data-fixture', 'sibling-count');
        count.appendChild(api.text('0'));
        rootEl.appendChild(count);
        return rootEl;
    }
}

/**
 * Parent: if/else branch + sibling component outside the if (commercial shape).
 */
class CompositionPage {
    static __vmzDirect = true;
    static __vmzState = ['showEmpty'];
    showEmpty = true;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'resume-composition');
        const block = api.ifBlock(
            this,
            null,
            ['showEmpty'],
            [
                {
                    cond: function () {
                        return this.showEmpty;
                    },
                    create: (api) => {
                        const wrap = api.el('div');
                        api.attr(wrap, 'data-fixture', 'branch-empty');
                        const btn = api.el('button');
                        api.attr(btn, 'type', 'button');
                        api.attr(btn, 'data-fixture', 'create-btn');
                        btn.appendChild(api.text('Create'));
                        api.on(btn, 'click', function () {
                            this.showEmpty = false;
                        });
                        wrap.appendChild(btn);
                        return wrap;
                    },
                },
                {
                    create: (api) => {
                        const wrap = api.el('div');
                        api.attr(wrap, 'data-fixture', 'branch-ready');
                        wrap.appendChild(api.text('Ready'));
                        return wrap;
                    },
                },
            ],
        );
        rootEl.appendChild(block);
        const sibling = api.component(this, 'SiblingHost', {}, null);
        rootEl.appendChild(sibling);
        return rootEl;
    }
}

registerComponents({ SiblingHost, CompositionPage });

console.log('resume-composition: SSR → hydrate…');
const html = await renderToString(CompositionPage, { props: {} });
if (!html.includes('data-fixture="branch-empty"')) fail(`SSR missing empty branch: ${html}`);
if (!html.includes('data-fixture="sibling-host"')) fail(`SSR missing sibling host: ${html}`);
if (html.includes('data-fixture="branch-ready"')) fail(`SSR must not render else branch: ${html}`);

const { window: live } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
globalThis.window = live;
globalThis.document = live.document;
globalThis.HTMLElement = live.HTMLElement;
globalThis.Node = live.Node;
globalThis.DocumentFragment = live.DocumentFragment;
globalThis.Text = live.Text;
globalThis.Comment = live.Comment;

const app = live.document.getElementById('app');
if (!app) fail('missing #app');
const inst = await hydrate(CompositionPage, app);

const siblingBefore = app.querySelector('[data-fixture="sibling-host"]');
if (!siblingBefore) fail('after hydrate: sibling host missing');
const siblingHostEl = siblingBefore;

console.log('resume-composition: switch if → else, sibling must survive…');
const createBtn = app.querySelector('[data-fixture="create-btn"]');
if (!createBtn) fail('create button missing after hydrate');
// Drive the branch via instance field (same dep ifBlock registered) — proves
// sibling survival independent of click wiring.
inst.showEmpty = false;
await flushPending(inst);

if (app.querySelector('[data-fixture="branch-empty"]')) fail('empty branch still present after switch');
if (!app.querySelector('[data-fixture="branch-ready"]')) fail('ready branch missing after switch');

const siblingAfter = app.querySelector('[data-fixture="sibling-host"]');
if (!siblingAfter) fail('sibling host removed when if/else switched (scoped adopt regression)');
if (siblingAfter !== siblingHostEl) {
    console.log('resume-composition: note sibling host node identity changed (allowed if interactive)');
}

console.log('resume-composition: sibling click after switch…');
const sibBtn = app.querySelector('[data-fixture="sibling-btn"]');
if (!sibBtn) fail('sibling button missing after switch');
sibBtn.dispatchEvent(new live.Event('click', { bubbles: true }));
const count = app.querySelector('[data-fixture="sibling-count"]')?.textContent;
if (count !== '1') fail(`sibling click dead after if switch, count=${count}`);

// Click path on a fresh hydrate: create button must flip the branch too.
console.log('resume-composition: create-btn click flips branch on fresh hydrate…');
const html2 = await renderToString(CompositionPage, { props: {} });
const { window: live2 } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html2}</div></body></html>`);
globalThis.window = live2;
globalThis.document = live2.document;
globalThis.HTMLElement = live2.HTMLElement;
globalThis.Node = live2.Node;
globalThis.DocumentFragment = live2.DocumentFragment;
globalThis.Text = live2.Text;
globalThis.Comment = live2.Comment;
const app2 = live2.document.getElementById('app');
const inst2 = await hydrate(CompositionPage, app2);
const createBtn2 = app2.querySelector('[data-fixture="create-btn"]');
if (!createBtn2) fail('create button missing on second hydrate');
createBtn2.dispatchEvent(new live2.Event('click', { bubbles: true }));
await flushPending(inst2);
if (!app2.querySelector('[data-fixture="branch-ready"]')) fail('create-btn click did not switch branch');
if (!app2.querySelector('[data-fixture="sibling-host"]')) fail('sibling lost after create-btn click switch');

console.log('resume-composition GATE PASS: if/else switch keeps sibling host interactive');

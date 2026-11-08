/**
 * v-memo-browser — dependency-gated subtrees in a real browser.
 *
 * `v-memo` must skip a subtree patch when its dependency array is shallow-equal
 * to the snapshot taken at create time, and apply it when it changed. This gate
 * builds the `v-memo` fixture for real, hydrates it in Chrome and drives the
 * page with real clicks. It covers:
 *
 * - skip/apply on text and attribute patches,
 * - `[]` never patching,
 * - memo roots joining the patch dependencies (changing an unused dep still
 *   wakes the subtree),
 * - `v-once` winning inside a memo subtree,
 * - nested `v-memo` using the nearest layer,
 * - per-row snapshots on `v-for` rows,
 * - create-time snapshots after an `v-if` branch is created later.
 *
 * Skipped patches must keep the exact element and text-node objects, so the
 * assertions compare object identity, not only text.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv, serveHostProjectEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'v-memo');
const dist = path.join(example, 'dist', 'web-ssr');
const PORT = 18786;

function fail(msg: string): never {
    console.error(`v-memo-browser GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('v-memo-browser: vmz build v-memo…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);
const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail(`missing ${hostJs}`);

const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
const puppeteer = requireFromTest('puppeteer-core');
const { resolveBrowserExecutable } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
);
const chrome = resolveBrowserExecutable();
if (!chrome) fail('Chrome/Edge not found for v-memo (set VMZ_BROWSER)');

const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostProjectEnv(example, {
        VMZ_DIST: dist,
        VMZ_HOST: '127.0.0.1',
        VMZ_PORT: String(PORT),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
});
let browser: any = null;
try {
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('serve-host start timeout')), 15000);
        child.stdout.on('data', (buf) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr.on('data', (buf) => process.stderr.write(buf));
        child.on('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`serve-host exited early ${code}`));
        });
    });

    const warm = await fetch(`http://127.0.0.1:${PORT}/`);
    if (!warm.ok) fail(`warm GET / failed: ${warm.status}`);
    const ssrHtml = await warm.text();
    const ssrValues: Array<[string, string]> = [
        ['outside', '0'],
        ['gated-text', '0'],
        ['empty-text', '0'],
        ['nested-outer', '0'],
        ['nested-inner-text', '0'],
        ['nested-inner-outer', '0'],
        ['once', '0'],
        ['once-sibling', '0'],
    ];
    for (const [id, value] of ssrValues) {
        if (!new RegExp(`id="${id}"[^>]*>\\s*${value}\\s*<`).test(ssrHtml)) {
            fail(`SSR markup for #${id} must carry the initial "${value}" value`);
        }
    }
    if (/id="branch-text"/.test(ssrHtml)) fail('SSR must not render the collapsed v-if branch');
    if (!/>\s*row-a-0-d0\s*</.test(ssrHtml) || !/>\s*row-b-0-d0\s*</.test(ssrHtml)) {
        fail('SSR rows must carry their initial text');
    }

    browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: any) => {
        const text = String(msg.text());
        // Resource 404s are judged by `badResponses`; the browser also logs them as errors.
        if (msg.type() === 'error' && !text.startsWith('Failed to load resource')) consoleErrors.push(text);
    });
    const badResponses: string[] = [];
    page.on('response', (response: any) => {
        if (response.status() >= 400 && !String(response.url()).endsWith('/favicon.ico')) {
            badResponses.push(`${response.status()} ${response.url()}`);
        }
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction('window.__memoReady === true', { timeout: 10000 });

    await page.evaluate(() => {
        const win = window as any;
        const $ = (sel: string) => document.querySelector(sel);
        const textNode = (el: Element | null) =>
            el ? Array.from(el.childNodes).find((node) => node.nodeType === 3) ?? null : null;
        const refs = {
            gated: $('#gated'),
            gatedText: $('#gated-text'),
            gatedTextChild: textNode($('#gated-text')),
            gatedAttr: $('#gated-attr'),
            empty: $('#gated-empty'),
            emptyTextChild: textNode($('#empty-text')),
            nestedOuter: $('#nested-outer'),
            nestedOuterChild: textNode($('#nested-outer')),
            nestedInnerOuter: $('#nested-inner-outer'),
            nestedInnerOuterChild: textNode($('#nested-inner-outer')),
            once: $('#once'),
            onceChild: textNode($('#once')),
            rows: Array.from(document.querySelectorAll('#rows li')),
        };
        win.__memoRefs = refs;
        win.__memoRead = () => {
            const text = (sel: string) => {
                const el = $(sel);
                return el ? String(el.textContent).trim() : null;
            };
            const liveRows = Array.from(document.querySelectorAll('#rows li'));
            return {
                outside: text('#outside'),
                gated: text('#gated-text'),
                gatedTitle: $('#gated-attr')?.getAttribute('title') ?? null,
                empty: text('#empty-text'),
                nestedOuter: text('#nested-outer'),
                nestedInnerText: text('#nested-inner-text'),
                nestedInnerOuter: text('#nested-inner-outer'),
                once: text('#once'),
                onceSibling: text('#once-sibling'),
                branch: text('#branch-text'),
                rows: liveRows.map((li) => String(li.textContent).trim()),
                rowsSame: liveRows.length === refs.rows.length && liveRows.every((li, i) => refs.rows[i] === li),
                same: {
                    gated: refs.gated === $('#gated'),
                    gatedText: refs.gatedText === $('#gated-text'),
                    gatedTextChild: refs.gatedTextChild === textNode($('#gated-text')),
                    gatedAttr: refs.gatedAttr === $('#gated-attr'),
                    empty: refs.empty === $('#gated-empty'),
                    emptyTextChild: refs.emptyTextChild === textNode($('#empty-text')),
                    nestedOuter: refs.nestedOuter === $('#nested-outer'),
                    nestedOuterChild: refs.nestedOuterChild === textNode($('#nested-outer')),
                    nestedInnerOuter: refs.nestedInnerOuter === $('#nested-inner-outer'),
                    nestedInnerOuterChild:
                        refs.nestedInnerOuterChild === textNode($('#nested-inner-outer')),
                    once: refs.once === $('#once'),
                    onceChild: refs.onceChild === textNode($('#once')),
                },
                memoAttrLeaked: document.querySelector('[v-memo]') !== null,
            };
        };
    });

    const read = () => page.evaluate(() => (window as any).__memoRead());
    const click = async (selector: string, readyExpr: string) => {
        await page.click(selector);
        try {
            await page.waitForFunction(readyExpr, { timeout: 5000 });
        } catch (error) {
            console.error(`v-memo-browser: ${selector} did not reach ${readyExpr}`);
            console.error(JSON.stringify(await read(), null, 2));
            throw error;
        }
    };
    const expect = (step: string, snap: any, want: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(want)) {
            if (Array.isArray(value)) {
                if (snap[key].join(',') !== value.join(',')) {
                    fail(`${step}: ${key} = [${snap[key].join(',')}] want [${value.join(',')}]`);
                }
                continue;
            }
            if (snap[key] !== value) fail(`${step}: ${key} = ${JSON.stringify(snap[key])} want ${JSON.stringify(value)}`);
        }
    };
    const expectSame = (step: string, snap: any, keys: string[]) => {
        for (const key of keys) {
            if (!snap.same[key]) fail(`${step}: skipped patch rebuilt ${key}`);
        }
    };

    const initial = await read();
    if (initial.memoAttrLeaked) fail('`v-memo` leaked as a DOM attribute');
    if (!initial.rowsSame) fail('initial rows are not the hydrated elements');
    expect('hydrate', initial, {
        outside: '0',
        gated: '0',
        gatedTitle: '0',
        empty: '0',
        nestedOuter: '0',
        nestedInnerText: '0',
        nestedInnerOuter: '0',
        once: '0',
        onceSibling: '0',
        branch: null,
        rows: ['row-a-0-d0', 'row-b-0-d0'],
    });

    // 1. Inner change: the `[dep]` subtree stays frozen, its surrounding text updates.
    await click('#bump-inner', 'document.querySelector("#outside").textContent.trim() === "1"');
    expect('inner=1', await read(), {
        outside: '1',
        gated: '0',
        gatedTitle: '0',
        empty: '0',
        nestedOuter: '0',
        nestedInnerText: '1',
        nestedInnerOuter: '0',
        once: '0',
        onceSibling: '0',
    });
    expectSame('inner=1', await read(), [
        'gated',
        'gatedText',
        'gatedTextChild',
        'gatedAttr',
        'empty',
        'emptyTextChild',
        'nestedOuter',
        'nestedOuterChild',
        'nestedInnerOuterChild',
        'once',
        'onceChild',
    ]);

    // 2. Memo dependency change: the subtree patch applies.
    await click('#bump-dep', 'document.querySelector("#gated-text").textContent.trim() === "1"');
    expect('dep=1', await read(), {
        outside: '1',
        gated: '1',
        gatedTitle: '1',
        empty: '0',
        nestedOuter: '0',
        nestedInnerText: '1',
        once: '0',
        onceSibling: '1',
    });
    expectSame('dep=1', await read(), ['gated', 'emptyTextChild', 'nestedOuterChild', 'once', 'onceChild']);

    // 3. A second inner change keeps the subtree stale at the last applied value.
    await click('#bump-inner', 'document.querySelector("#outside").textContent.trim() === "2"');
    expect('inner=2', await read(), {
        outside: '2',
        gated: '1',
        gatedTitle: '1',
        empty: '0',
        nestedOuter: '0',
        nestedInnerText: '2',
        nestedInnerOuter: '0',
        once: '0',
        onceSibling: '1',
    });
    expectSame('inner=2', await read(), [
        'gatedTextChild',
        'gatedAttr',
        'emptyTextChild',
        'nestedOuterChild',
        'onceChild',
    ]);

    // 4. Outer change: the outer layer applies while the nested `[inner]` layer stays frozen.
    await click('#bump-outer', 'document.querySelector("#nested-outer").textContent.trim() === "1"');
    expect('outer=1', await read(), {
        outside: '2',
        gated: '1',
        empty: '0',
        nestedOuter: '1',
        nestedInnerText: '2',
        nestedInnerOuter: '0',
        once: '0',
        onceSibling: '1',
    });
    expectSame('outer=1', await read(), ['gatedTextChild', 'emptyTextChild', 'nestedInnerOuterChild', 'onceChild']);

    // 5. Row text change with an equal `row.dep`: each row keeps both node and text.
    await click(
        '#bump-row-text',
        'document.querySelector("#rows-live").textContent.trim() === "row-a-0-plus"',
    );
    expect('row text only', await read(), { rows: ['row-a-0-d0', 'row-b-0-d0'] });

    // 6. Row dependency change: rows keep their elements but receive the latest text.
    await click('#bump-row-dep', 'document.querySelector("#rows li").textContent.trim() === "row-a-0-plus-d1"');
    expect('row dep changed', await read(), { rows: ['row-a-0-plus-d1', 'row-b-0-plus-d1'] });
    if (!(await read()).rowsSame) fail('row dependency change rebuilt the row elements');

    // 7. A later-created `v-if` branch takes its own create-time snapshot.
    await click('#toggle-show', 'document.querySelector("#branch-text") !== null');
    expect('branch created', await read(), { branch: '2' });
    await page.evaluate(() => {
        const win = window as any;
        const el = document.querySelector('#branch-text');
        win.__memoRefs.branchChild = el ? Array.from(el.childNodes).find((n: any) => n.nodeType === 3) ?? null : null;
    });
    await click('#bump-inner', 'document.querySelector("#outside").textContent.trim() === "3"');
    {
        const snap = await read();
        if (snap.branch !== '2') fail(`branch=... inner change must stay frozen, got ${snap.branch}`);
        const same = await page.evaluate(() => {
            const win = window as any;
            const el = document.querySelector('#branch-text');
            const child = el ? Array.from(el.childNodes).find((n: any) => n.nodeType === 3) ?? null : null;
            return win.__memoRefs.branchChild === child;
        });
        if (!same) fail('inner change rebuilt the created branch subtree');
    }
    await click('#bump-dep', 'document.querySelector("#branch-text").textContent.trim() === "3"');
    expect('branch dep changed', await read(), { branch: '3', gated: '3', gatedTitle: '3' });

    if (badResponses.length > 0) fail(`browser requests failed: ${badResponses.join(' | ')}`);
    if (consoleErrors.length > 0) fail(`browser console errors: ${consoleErrors.join(' | ')}`);
    console.log(
        'v-memo-browser: dep gating, empty deps, memo roots, v-once, nesting, row snapshots and create-time snapshots PASS',
    );
} finally {
    if (browser) await browser.close();
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

console.log('v-memo-browser GATE PASS');

/**
 * A2 Router production — multi-page file routes on real vmz-serve-host.
 * Proves SSR routes, Link hrefs, load/access/action, navigation cancel,
 * and Layout SSR chain + layout retention (page dispose/create).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const PORT = 18771;

function fail(msg: string): never {
    console.error(`router-production FAIL: ${msg}`);
    process.exit(1);
}

function get(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(parts).toString('utf8'),
                    headers: res.headers,
                }),
            );
        });
        req.on('error', reject);
    });
}

function postJson(url: string, body: unknown): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                const parts: Buffer[] = [];
                res.on('data', (c) => parts.push(c));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(parts).toString('utf8'),
                        headers: res.headers,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/** Abort an in-flight GET mid-body / mid-loader. */
function getThenAbort(url: string, afterMs: number): Promise<{ aborted: boolean; status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () =>
                resolve({
                    aborted: false,
                    status: res.statusCode || 0,
                    body: Buffer.concat(parts).toString('utf8'),
                }),
            );
        });
        req.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNRESET' || err.message.includes('socket')) {
                resolve({ aborted: true, status: 0, body: '' });
                return;
            }
            reject(err);
        });
        setTimeout(() => {
            try {
                req.destroy();
            } catch {
                /* ignore */
            }
        }, afterMs);
    });
}

console.log('router-production: build production-router…');
const build = runVmzBuild(EXAMPLE, root);
const proof = readProof(root);
if (build.status !== 0) {
    upsertCheck(proof, {
        id: 'router-production.build',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    addLimitation(proof, 'A2: production-router failed to build');
    writeProof(proof, root);
    fail(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const dist = build.dist;
const hostJs = path.join(dist, 'vmz-serve-host.mjs');

const indexClient = fs.readFileSync(path.join(dist, 'pages', 'index.client.js'), 'utf8');
if (!indexClient.includes('/about') || !indexClient.includes('/products/sku-1')) {
    fail(`index.client.js missing RouteId Link href lowering: ${indexClient.slice(0, 400)}`);
}
if (indexClient.includes('api.component(this, "Link"')) {
    fail('index.client.js still emits Link as component');
}
if (!indexClient.includes('data-vmz-route') || !indexClient.includes('AboutPage')) {
    fail(`index.client.js missing data-vmz-route RouteId: ${indexClient.slice(0, 500)}`);
}
if (!indexClient.includes('/shop')) {
    fail(`index.client.js missing Shop Link href: ${indexClient.slice(0, 400)}`);
}
if (!fs.existsSync(path.join(dist, 'vmz-client-nav.js'))) {
    fail('missing vmz-client-nav.js runtime copy');
}

const productClient = fs.readFileSync(path.join(dist, 'pages', 'products', '[id].client.js'), 'utf8');
if (!productClient.includes('access') || !productClient.includes('action')) {
    fail(`product client missing access/action methods: ${productClient.slice(0, 500)}`);
}

const layoutPath = path.join(dist, 'pages', 'shop', 'Layout.client.js');
if (!fs.existsSync(layoutPath)) fail(`missing shop Layout emit: ${layoutPath}`);

console.log('router-production: in-process cancel + layout retention…');
let cancelDetail = '';
let layoutDetail = '';
try {
    cancelDetail = await proveNavCancel(dist);
    layoutDetail = await proveLayoutRetention(dist);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});

function killChild() {
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

try {
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('serve-host start timeout')), 8000);
        const onData = (buf: Buffer) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(t);
                child.stdout.off('data', onData);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (b) => process.stderr.write(b));
        child.on('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`serve-host exited early ${code}`));
        });
    });

    const home = await get(`http://127.0.0.1:${PORT}/`);
    const about = await get(`http://127.0.0.1:${PORT}/about`);
    const product = await get(`http://127.0.0.1:${PORT}/products/sku-1`);
    const blocked = await get(`http://127.0.0.1:${PORT}/products/blocked`);
    const secret = await get(`http://127.0.0.1:${PORT}/products/secret`);
    const elsewhere = await get(`http://127.0.0.1:${PORT}/products/elsewhere`);
    const actionOk = await postJson(`http://127.0.0.1:${PORT}/products/sku-1`, { note: 'from-action' });
    const actionRedirect = await postJson(`http://127.0.0.1:${PORT}/products/bounce`, { note: 'x' });
    const shop = await get(`http://127.0.0.1:${PORT}/shop`);
    const offer = await get(`http://127.0.0.1:${PORT}/shop/offer`);
    const aborted = await getThenAbort(`http://127.0.0.1:${PORT}/products/sku-1?slow=1`, 20);

    const errors: string[] = [];
    if (home.status !== 200 || !home.body.includes('route-home')) {
        errors.push(`GET / want 200+route-home, got ${home.status} ${home.body.slice(0, 160)}`);
    }
    if (about.status !== 200 || !about.body.includes('route-about')) {
        errors.push(`GET /about want 200+route-about, got ${about.status} ${about.body.slice(0, 160)}`);
    }
    if (product.status !== 200 || !product.body.includes('route-product')) {
        errors.push(`GET /products/sku-1 want 200+route-product, got ${product.status} ${product.body.slice(0, 160)}`);
    }
    if (home.body === about.body) errors.push('home and about HTML must differ');

    if (!home.body.includes('href="/about"') || !home.body.includes('href="/products/sku-1"')) {
        errors.push(`home SSR missing Link hrefs: ${home.body.slice(0, 400)}`);
    }
    if (!home.body.includes('data-vmz-route="AboutPage"') || !home.body.includes('data-vmz-route="ProductPage"')) {
        const navSlice = home.body.includes('<nav>')
            ? home.body.slice(home.body.indexOf('<nav>'), home.body.indexOf('<nav>') + 320)
            : home.body.slice(-400);
        errors.push(`home SSR missing data-vmz-route on Links: ${navSlice}`);
    }
    if (!about.body.includes('href="/"')) {
        errors.push(`about SSR missing Link home href: ${about.body.slice(0, 400)}`);
    }
    if (!product.body.includes('loader-title:Widget sku-1')) {
        errors.push(`product SSR missing Page.load data: ${product.body.slice(0, 500)}`);
    }
    if (!product.body.includes('data-vmz-props') || !product.body.includes('sku-1')) {
        errors.push(`product SSR missing data-vmz-props with params: ${product.body.slice(0, 300)}`);
    }

    if (blocked.status !== 404 || !blocked.body.includes('route-access-not-found')) {
        errors.push(`access not-found want 404+marker, got ${blocked.status} ${blocked.body.slice(0, 200)}`);
    }
    if (secret.status !== 403 || !secret.body.includes('route-access-deny')) {
        errors.push(`access deny want 403+marker, got ${secret.status} ${secret.body.slice(0, 200)}`);
    }
    if (elsewhere.status !== 302 || String(elsewhere.headers.location || '') !== '/about') {
        errors.push(`access redirect want 302 Location=/about, got ${elsewhere.status} ${elsewhere.headers.location}`);
    }

    if (actionOk.status !== 200 || !actionOk.body.includes('action-note:from-action')) {
        errors.push(`POST action want action-note, got ${actionOk.status} ${actionOk.body.slice(0, 400)}`);
    }
    if (!actionOk.body.includes('loader-title:Widget sku-1')) {
        errors.push(`POST action must still run Page.load: ${actionOk.body.slice(0, 400)}`);
    }
    if (actionRedirect.status !== 302 || String(actionRedirect.headers.location || '') !== '/about') {
        errors.push(`POST action redirect want 302 /about, got ${actionRedirect.status} ${actionRedirect.headers.location}`);
    }

    if (shop.status !== 200 || !shop.body.includes('layout-shop') || !shop.body.includes('route-shop')) {
        errors.push(`GET /shop want layout+page, got ${shop.status} ${shop.body.slice(0, 400)}`);
    }
    if (!shop.body.includes('data-vmz-layout') || !shop.body.includes('shop/Layout')) {
        errors.push(`GET /shop missing data-vmz-layout: ${shop.body.slice(0, 300)}`);
    }
    if (offer.status !== 200 || !offer.body.includes('layout-shop') || !offer.body.includes('route-shop-offer')) {
        errors.push(`GET /shop/offer want layout+offer, got ${offer.status} ${offer.body.slice(0, 400)}`);
    }
    if (shop.body.includes('route-shop-offer') || offer.body.includes('>route-shop<')) {
        errors.push('shop and offer page markers must not cross-contaminate');
    }

    // Client abort during slow loader: connection reset and/or cancel marker — never STALE-CANCELLED in a completed 200.
    if (!aborted.aborted && aborted.status === 200 && aborted.body.includes('STALE-CANCELLED')) {
        errors.push('aborted slow load must not serve STALE-CANCELLED as success HTML');
    }
    if (!aborted.aborted && aborted.status === 200 && aborted.body.includes('loader-title:Widget')) {
        // Slow path finished before destroy — still ok if race; require in-process cancel evidence instead.
    }

    console.log('router-production: Browser SPA client transition…');
    let spaDetail = '';
    try {
        spaDetail = await proveClientTransition(`http://127.0.0.1:${PORT}/`);
    } catch (e) {
        errors.push(`SPA takeover: ${e instanceof Error ? e.message : String(e)}`);
        spaDetail = e instanceof Error ? e.message : String(e);
    }

    upsertCheck(proof, {
        id: 'router-production.build',
        status: 'passed',
        detail: dist,
    });
    upsertCheck(proof, {
        id: 'router-production.serve-routes',
        status: errors.some((e) => e.startsWith('GET /') || e.includes('home and about')) ? 'failed' : 'passed',
        detail: '/, /about, /products/:id, /shop SSR ok',
    });
    upsertCheck(proof, {
        id: 'router-production.link-href',
        status: errors.some((e) => e.includes('Link') || e.includes('data-vmz-route')) ? 'failed' : 'passed',
        detail: 'RouteId Link → <a href> + data-vmz-route',
    });
    upsertCheck(proof, {
        id: 'router-production.loader',
        status: errors.some((e) => e.includes('Page.load') || e.includes('data-vmz-props')) ? 'failed' : 'passed',
        detail: 'Page.load props in SSR HTML',
    });
    upsertCheck(proof, {
        id: 'router-production.access',
        status: errors.some((e) => e.includes('access ')) ? 'failed' : 'passed',
        detail: 'Page.access allow/redirect/not-found/deny on serve-host',
    });
    upsertCheck(proof, {
        id: 'router-production.action',
        status: errors.some((e) => e.includes('POST action') || e.includes('action-note')) ? 'failed' : 'passed',
        detail: 'Page.action POST props + redirect on serve-host',
    });
    upsertCheck(proof, {
        id: 'router-production.nav-cancel',
        status: 'passed',
        detail: cancelDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.layout',
        status: errors.some((e) => e.includes('/shop') || e.includes('layout')) ? 'failed' : 'passed',
        detail: layoutDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.client-transition',
        status: errors.some((e) => e.startsWith('SPA ')) ? 'failed' : 'passed',
        detail: spaDetail,
    });

    const gaps = [
        'A2: scroll/focus restoration + locale realization not yet covered',
        'A2: SPA layout retention (shared Layout ticks across client transition) not yet covered',
    ];
    for (const g of gaps) addLimitation(proof, g);
    proof.knownLimitations = proof.knownLimitations.filter(
        (l) =>
            !l.includes('A2: real multi-page Router on vmz serve') &&
            !l.includes('A2: loader/access/action/navigation cancellation not yet in this driver') &&
            !l.includes('A2: access/action/navigation cancellation not yet in this driver') &&
            !l.includes('A2: navigation cancellation not yet in this driver') &&
            !l.includes('A2: layout retention / scroll-focus / locale realization not yet covered') &&
            !l.includes('A2: Browser Host client transition + RouteId Link not yet covered') &&
            !l.includes('A2: Browser Host client transition (SPA takeover) not yet covered'),
    );

    writeProof(proof, root);
    if (errors.length) fail(errors.join('\n'));
} finally {
    killChild();
}

console.log('router-production PASS: routes + Link + load/access/action + nav-cancel + layout + SPA takeover');
console.log('router-production NOTE: scroll/focus / locale / SPA layout retention still open');

async function loadPuppeteerCore(): Promise<any> {
    // Resolve via @vmz/test (owns puppeteer-core as CDP transport). Bare import fails from this package.
    const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
    try {
        const mod = requireFromTest('puppeteer-core');
        return mod?.default ?? mod;
    } catch (err) {
        throw new Error(`puppeteer-core required for SPA proof (via @vmz/test). ${err instanceof Error ? err.message : err}`);
    }
}

async function proveClientTransition(homeUrl: string): Promise<string> {
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found for SPA takeover proof (set VMZ_BROWSER)');

    const puppeteer = await loadPuppeteerCore();
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await page.goto(homeUrl, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForFunction('window.__vmzClientNavInstalled === true', { timeout: 10000 });
        const bootBefore = await page.evaluate(() => (window as any).__vmzBootId);
        if (!bootBefore) throw new Error('missing __vmzBootId after hydrate');

        const aboutHref = await page.$('a[data-vmz-route="AboutPage"]');
        if (!aboutHref) throw new Error('hydrated DOM missing a[data-vmz-route=AboutPage]');
        await aboutHref.click();
        await page.waitForFunction(() => location.pathname === '/about' && document.body.innerText.includes('route-about'), { timeout: 10000 });
        const after = await page.evaluate(() => ({
            path: location.pathname,
            boot: (window as any).__vmzBootId,
            count: (window as any).__vmzClientNavCount || 0,
            text: document.body.innerText,
        }));
        if (after.path !== '/about') throw new Error(`pathname want /about got ${after.path}`);
        if (after.boot !== bootBefore) throw new Error('full reload detected (__vmzBootId changed)');
        if (after.count < 1) throw new Error('__vmzClientNavCount not incremented');
        if (!after.text.includes('route-about')) throw new Error('about marker missing after SPA nav');

        // History back should client-navigate too.
        await page.goBack({ waitUntil: 'networkidle0' });
        await page.waitForFunction(() => location.pathname === '/' && document.body.innerText.includes('route-home'), { timeout: 10000 });
        const back = await page.evaluate(() => ({
            path: location.pathname,
            boot: (window as any).__vmzBootId,
            count: (window as any).__vmzClientNavCount || 0,
        }));
        if (back.path !== '/') throw new Error(`back want / got ${back.path}`);
        if (back.boot !== bootBefore) throw new Error('full reload on popstate');
        if (back.count < 2) throw new Error('popstate did not count as client nav');

        return 'Link click + popstate SPA takeover (bootId stable, no full reload)';
    } finally {
        await browser.close();
    }
}

async function proveNavCancel(distDir: string): Promise<string> {
    const ProductPage = (await import(pathToFileURL(path.join(distDir, 'pages', 'products', '[id].client.js')).href)).default;
    const ac = new AbortController();
    const p = ProductPage.load({
        params: { id: 'sku-1' },
        signal: ac.signal,
        searchParams: new URLSearchParams('slow=1'),
    });
    await new Promise((r) => setTimeout(r, 15));
    ac.abort();
    const loaded = await p;
    if (!ac.signal.aborted) throw new Error('expected aborted signal');
    if (loaded?.title === 'Widget sku-1') {
        throw new Error('cancelled slow load must not return success title');
    }
    // Generation supersede: newer load wins; older abort must not apply success.
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const slow1 = ProductPage.load({
        params: { id: 'old' },
        signal: ac1.signal,
        searchParams: new URLSearchParams('slow=1'),
    });
    await new Promise((r) => setTimeout(r, 10));
    ac1.abort();
    const slow2 = ProductPage.load({
        params: { id: 'new' },
        signal: ac2.signal,
        searchParams: new URLSearchParams(),
    });
    const [r1, r2] = await Promise.all([slow1, slow2]);
    if (r2?.title !== 'Widget new') throw new Error(`newer load want Widget new, got ${r2?.title}`);
    if (r1?.title === 'Widget old') throw new Error('older cancelled load must not succeed as Widget old');
    return 'AbortSignal cancel + generation supersede on Page.load';
}

async function proveLayoutRetention(distDir: string): Promise<string> {
    const { parseHTML } = await import('linkedom');
    const { window } = parseHTML('<!doctype html><html><body><div id="layout"></div><div id="page"></div></body></html>');
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).Node = window.Node;

    const dom = await import(pathToFileURL(path.join(distDir, 'vmz-dom.js')).href);
    const Layout = (await import(pathToFileURL(path.join(distDir, 'pages', 'shop', 'Layout.client.js')).href)).default;
    const ShopIndex = (await import(pathToFileURL(path.join(distDir, 'pages', 'shop', 'index.client.js')).href)).default;
    const ShopOffer = (await import(pathToFileURL(path.join(distDir, 'pages', 'shop', 'offer.client.js')).href)).default;

    const layoutEl = document.getElementById('layout');
    const pageEl = document.getElementById('page');
    const layoutInst = await dom.mount(Layout, layoutEl, {});
    layoutInst.bump();
    if (layoutInst.ticks !== 1) throw new Error(`layout ticks want 1, got ${layoutInst.ticks}`);

    const pageA = await dom.mount(ShopIndex, pageEl, {});
    if (!String(pageEl.textContent || '').includes('route-shop')) {
        throw new Error('page A missing route-shop');
    }
    dom.destroy(pageA);
    const pageB = await dom.mount(ShopOffer, pageEl, {});
    if (!String(pageEl.textContent || '').includes('route-shop-offer')) {
        throw new Error('page B missing route-shop-offer');
    }
    if (layoutInst.ticks !== 1) {
        throw new Error(`layout must retain ticks across page dispose/create, got ${layoutInst.ticks}`);
    }
    if (!String(layoutEl.textContent || '').includes('layout-shop')) {
        throw new Error('layout region disposed unexpectedly');
    }
    dom.destroy(pageB);
    dom.destroy(layoutInst);
    return 'Layout SSR chain + page dispose/create retains layout ticks';
}

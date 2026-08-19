/**
 * A2 Router production — multi-page file routes on real vmz-serve-host.
 * Proves SSR routes, Link hrefs, load/access/action, navigation cancel,
 * Layout SSR chain + in-process page dispose/create retention, and
 * Browser SPA same-layout retention (shared Layout ticks across client nav).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';

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
if (!indexClient.includes('/welcome')) {
    fail(`index.client.js missing explicit LandingPage href /welcome: ${indexClient.slice(0, 400)}`);
}
const deployment = JSON.parse(fs.readFileSync(path.join(dist, 'vmz-deployment.json'), 'utf8'));
const landingUnit = (deployment.units || []).find((u: { chunkId?: string }) => u.chunkId === 'pages/landing');
if (landingUnit?.pathPattern !== '/welcome') {
    fail(`pages/landing pathPattern want /welcome, got ${JSON.stringify(landingUnit)}`);
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
    env: serveHostChildEnv({
        VMZ_DIST: dist,
        VMZ_HOST: '127.0.0.1',
        VMZ_PORT: String(PORT),
    }),
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
    const welcome = await get(`http://127.0.0.1:${PORT}/welcome`);
    const landingFile = await get(`http://127.0.0.1:${PORT}/landing`);
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
    if (welcome.status !== 200 || !welcome.body.includes('route-welcome')) {
        errors.push(`GET /welcome want explicit path landing page, got ${welcome.status} ${welcome.body.slice(0, 200)}`);
    }
    if (landingFile.status === 200 && landingFile.body.includes('route-welcome')) {
        errors.push('GET /landing must not match pages/landing when path is /welcome');
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

    // 浏览器侧：同一 Layout 链下 client 换页不得重建 Layout（ticks 必须保留）
    console.log('router-production: Browser SPA layout retention…');
    let spaLayoutDetail = '';
    try {
        spaLayoutDetail = await proveSpaLayoutRetention(`http://127.0.0.1:${PORT}/shop`);
    } catch (e) {
        errors.push(`SPA layout retention: ${e instanceof Error ? e.message : String(e)}`);
        spaLayoutDetail = e instanceof Error ? e.message : String(e);
    }

    console.log('router-production: scroll/focus restoration…');
    let scrollFocusDetail = '';
    try {
        scrollFocusDetail = await proveScrollFocus(`http://127.0.0.1:${PORT}/shop`);
    } catch (e) {
        errors.push(`scroll/focus: ${e instanceof Error ? e.message : String(e)}`);
        scrollFocusDetail = e instanceof Error ? e.message : String(e);
    }

    console.log('router-production: locale realization…');
    let localeDetail = '';
    try {
        localeDetail = await proveLocaleRealization(dist, `http://127.0.0.1:${PORT}`);
    } catch (e) {
        errors.push(`locale realization: ${e instanceof Error ? e.message : String(e)}`);
        localeDetail = e instanceof Error ? e.message : String(e);
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
        // SSR /shop markers only — do not conflate with SPA layout retention errors.
        status: errors.some((e) => e.includes('GET /shop') || e.includes('shop and offer')) ? 'failed' : 'passed',
        detail: layoutDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.client-transition',
        status: errors.some((e) => e.startsWith('SPA takeover:')) ? 'failed' : 'passed',
        detail: spaDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.spa-layout-retention',
        status: errors.some((e) => e.startsWith('SPA layout retention:')) ? 'failed' : 'passed',
        detail: spaLayoutDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.scroll-focus',
        status: errors.some((e) => e.startsWith('scroll/focus:')) ? 'failed' : 'passed',
        detail: scrollFocusDetail,
    });
    upsertCheck(proof, {
        id: 'router-production.locale',
        status: errors.some((e) => e.startsWith('locale realization:')) ? 'failed' : 'passed',
        detail: localeDetail,
    });

    // P2 scroll/focus + locale realization closed on this driver.
    proof.knownLimitations = proof.knownLimitations.filter(
        (l) =>
            !l.includes('A2: real multi-page Router on vmz serve') &&
            !l.includes('A2: loader/access/action/navigation cancellation not yet in this driver') &&
            !l.includes('A2: access/action/navigation cancellation not yet in this driver') &&
            !l.includes('A2: navigation cancellation not yet in this driver') &&
            !l.includes('A2: layout retention / scroll-focus / locale realization not yet covered') &&
            !l.includes('A2: scroll/focus restoration + locale realization not yet covered') &&
            !l.includes('A2: SPA layout retention (shared Layout ticks across client transition) not yet covered') &&
            !l.includes('A2: Browser Host client transition + RouteId Link not yet covered') &&
            !l.includes('A2: Browser Host client transition (SPA takeover) not yet covered'),
    );

    writeProof(proof, root);
    if (errors.length) fail(errors.join('\n'));
} finally {
    killChild();
}

console.log(
    'router-production PASS: routes + Link + load/access/action + nav-cancel + layout + SPA takeover + SPA layout retention + scroll/focus + locale',
);
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

/**
 * 证明共享 Layout 在 client 换页时被保留：bump ticks 后点 Link，ticks 与 layout 实例不得重置。
 * @param shopUrl 已部署的 /shop URL
 */
async function proveSpaLayoutRetention(shopUrl: string): Promise<string> {
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found for SPA layout retention proof (set VMZ_BROWSER)');

    const puppeteer = await loadPuppeteerCore();
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await page.goto(shopUrl, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForFunction('window.__vmzClientNavInstalled === true', { timeout: 10000 });

        // 先 bump Layout.ticks，建立「实例存活」证据
        const bumped = await page.evaluate(() => {
            const root = document.getElementById('app') as any;
            const layouts = root && root.__vmzLayoutInsts;
            if (!Array.isArray(layouts) || layouts.length < 1) {
                return { ok: false, reason: 'missing __vmzLayoutInsts after hydrateRoute' };
            }
            const layout = layouts[0];
            if (typeof layout.bump !== 'function') {
                return { ok: false, reason: 'ShopLayout.bump missing' };
            }
            layout.bump();
            return {
                ok: true,
                ticks: layout.ticks,
                text: document.body.innerText,
            };
        });
        if (!bumped.ok) throw new Error(String((bumped as { reason?: string }).reason || 'bump failed'));
        if (bumped.ticks !== 1) throw new Error(`layout ticks want 1 after bump, got ${bumped.ticks}`);
        await page.waitForFunction(() => document.body.innerText.includes('layout-ticks:1'), { timeout: 5000 });

        const bootBefore = await page.evaluate(() => (window as any).__vmzBootId);
        const offerLink = await page.$('a[data-vmz-route="ShopOfferPage"]');
        if (!offerLink) throw new Error('shop DOM missing a[data-vmz-route=ShopOfferPage]');
        await offerLink.click();
        await page.waitForFunction(
            () =>
                location.pathname === '/shop/offer' &&
                document.body.innerText.includes('route-shop-offer') &&
                document.body.innerText.includes('layout-shop'),
            { timeout: 10000 },
        );

        const after = await page.evaluate(() => {
            const root = document.getElementById('app') as any;
            const layouts = root && root.__vmzLayoutInsts;
            const last = (window as any).__vmzLastClientNav || {};
            return {
                path: location.pathname,
                boot: (window as any).__vmzBootId,
                retained: !!last.retainedLayout,
                ticks: Array.isArray(layouts) && layouts[0] ? layouts[0].ticks : null,
                text: document.body.innerText,
                layoutAttr: root ? root.getAttribute('data-vmz-layout') : null,
            };
        });
        if (after.path !== '/shop/offer') throw new Error(`pathname want /shop/offer got ${after.path}`);
        if (after.boot !== bootBefore) throw new Error('full reload during layout-retained SPA nav');
        if (!after.retained) throw new Error('__vmzLastClientNav.retainedLayout must be true');
        if (after.ticks !== 1) {
            throw new Error(`shared Layout ticks must stay 1 across SPA page swap, got ${after.ticks}`);
        }
        if (!after.text.includes('layout-ticks:1')) {
            throw new Error('DOM layout-ticks binding reset (layout remounted)');
        }
        if (after.text.includes('route-shop') && !after.text.includes('route-shop-offer')) {
            throw new Error('page region not swapped to offer');
        }
        if (!String(after.layoutAttr || '').includes('shop/Layout')) {
            throw new Error(`data-vmz-layout missing after retention: ${after.layoutAttr}`);
        }

        return 'SPA same-layout nav retains Layout ticks (shop→offer, retainedLayout=true)';
    } finally {
        await browser.close();
    }
}

/**
 * Route Transition Plan: forward nav scrolls to top + focuses main; popstate restores scrollY.
 */
async function proveScrollFocus(shopUrl: string): Promise<string> {
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found for scroll/focus proof (set VMZ_BROWSER)');

    const puppeteer = await loadPuppeteerCore();
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await page.setViewport({ width: 900, height: 700 });
        await page.goto(shopUrl, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForFunction('window.__vmzClientNavInstalled === true', { timeout: 10000 });

        await page.evaluate(() => window.scrollTo(0, 1400));
        await page.waitForFunction(() => window.scrollY > 1000, { timeout: 5000 });
        const beforeY = await page.evaluate(() => window.scrollY);
        if (beforeY < 1000) throw new Error(`expected scrolled shop, scrollY=${beforeY}`);

        // Click via DOM (no scroll-into-view) so saveScroll captures depth — Puppeteer's
        // ElementHandle.click() scrolls the target into view and would wipe scrollY first.
        const clicked = await page.evaluate(() => {
            const a = document.querySelector('a[data-vmz-route="ShopOfferPage"]') as HTMLAnchorElement | null;
            if (!a) return false;
            a.click();
            return true;
        });
        if (!clicked) throw new Error('missing ShopOfferPage link');
        await page.waitForFunction(
            () => {
                const last = (window as any).__vmzLastClientNav || {};
                return (
                    location.pathname === '/shop/offer' &&
                    document.body.innerText.includes('route-shop-offer') &&
                    last.scrollMode === 'top' &&
                    (last.focusTarget === 'offer-main' || document.activeElement?.getAttribute?.('data-vmz-focus') === 'offer-main')
                );
            },
            { timeout: 10000 },
        );

        const afterFwd = await page.evaluate(() => {
            const last = (window as any).__vmzLastClientNav || {};
            const active = document.activeElement as HTMLElement | null;
            return {
                scrollY: window.scrollY,
                scrollMode: last.scrollMode,
                focusTarget: last.focusTarget,
                activeFocus: active?.getAttribute?.('data-vmz-focus') || active?.tagName?.toLowerCase() || null,
            };
        });
        if (afterFwd.scrollY > 40) throw new Error(`forward nav must scroll to top, got scrollY=${afterFwd.scrollY}`);
        if (afterFwd.scrollMode !== 'top') throw new Error(`scrollMode want top, got ${afterFwd.scrollMode}`);
        if (afterFwd.focusTarget !== 'offer-main' && afterFwd.activeFocus !== 'offer-main') {
            throw new Error(`focus want offer-main, got focus=${afterFwd.focusTarget} active=${afterFwd.activeFocus}`);
        }

        await page.goBack({ waitUntil: 'networkidle0' });
        try {
            await page.waitForFunction(
                () => {
                    const last = (window as any).__vmzLastClientNav || {};
                    return (
                        location.pathname === '/shop' &&
                        document.body.innerText.includes('route-shop') &&
                        last.scrollMode === 'restored' &&
                        typeof last.scrollY === 'number' &&
                        window.scrollY > 1000 &&
                        !!document.querySelector('[data-vmz-scroll-pad]')
                    );
                },
                { timeout: 15000 },
            );
        } catch (err) {
            const dump = await page.evaluate(() => {
                const last = (window as any).__vmzLastClientNav || {};
                return {
                    path: location.pathname,
                    textHasShop: document.body.innerText.includes('route-shop'),
                    scrollY: window.scrollY,
                    scrollMode: last.scrollMode,
                    lastScrollY: last.scrollY,
                    href: last.href,
                    hasPad: !!document.querySelector('[data-vmz-scroll-pad]'),
                    padHeight: (document.querySelector('[data-vmz-scroll-pad]') as HTMLElement | null)?.offsetHeight || 0,
                    bodyHeight: document.body.scrollHeight,
                    retained: !!last.retainedLayout,
                };
            });
            throw new Error(`popstate scroll restore wait failed: ${JSON.stringify(dump)} (${err instanceof Error ? err.message : err})`);
        }
        const afterBack = await page.evaluate(() => {
            const last = (window as any).__vmzLastClientNav || {};
            return {
                scrollY: window.scrollY,
                scrollMode: last.scrollMode,
                path: location.pathname,
                hasPad: !!document.querySelector('[data-vmz-scroll-pad]'),
                padHeight: (document.querySelector('[data-vmz-scroll-pad]') as HTMLElement | null)?.offsetHeight || 0,
                bodyHeight: document.body.scrollHeight,
                href: last.href,
                retained: !!last.retainedLayout,
            };
        });
        if (afterBack.scrollMode !== 'restored') {
            throw new Error(`popstate scrollMode want restored, got ${JSON.stringify(afterBack)}`);
        }
        if (afterBack.scrollY < 1000) {
            throw new Error(`popstate must restore shop scrollY (~${beforeY}), got ${JSON.stringify(afterBack)}`);
        }
        if (!afterBack.hasPad || afterBack.padHeight < 2000) {
            throw new Error(`shop scroll-pad missing after popstate: ${JSON.stringify(afterBack)}`);
        }

        return `forward top+focus(offer-main); popstate restored scrollY=${Math.round(afterBack.scrollY)}`;
    } finally {
        await browser.close();
    }
}

/**
 * Locale realization: artifact + SSR lang/hreflang + prefixed path + SPA locale commit.
 */
async function proveLocaleRealization(distDir: string, baseUrl: string): Promise<string> {
    const artPath = path.join(distDir, '_vmz', 'locale-route-realization.json');
    if (!fs.existsSync(artPath)) throw new Error('missing _vmz/locale-route-realization.json');
    const art = JSON.parse(fs.readFileSync(artPath, 'utf8'));
    if (art.schema !== 'vmz.locale.route_realization.v0') throw new Error(`bad locale artifact schema ${art.schema}`);
    if (art.defaultLocale !== 'en-us') throw new Error(`defaultLocale want en-us, got ${art.defaultLocale}`);
    const aboutEn = (art.realizations || []).find((r: any) => r.routeId === 'pages/about' && r.localeId === 'en-us');
    const aboutZh = (art.realizations || []).find((r: any) => r.routeId === 'pages/about' && r.localeId === 'zh-hans');
    if (!aboutEn || aboutEn.path !== '/about') throw new Error('en-us about realization path want /about');
    if (!aboutZh || aboutZh.path !== '/zh-hans/about') throw new Error('zh-hans about realization path want /zh-hans/about');

    const home = await get(`${baseUrl}/`);
    if (home.status !== 200) throw new Error(`GET / locale home status ${home.status}`);
    if (!home.body.includes('lang="en-us"') || !home.body.includes('data-locale="en-us"')) {
        throw new Error(`home missing en-us lang/data-locale: ${home.body.slice(0, 300)}`);
    }
    if (!home.body.includes('data-vmz-locale="en-us"')) throw new Error('home missing data-vmz-locale');
    if (!home.body.includes('hreflang="zh-hans"') || !home.body.includes('hreflang="x-default"')) {
        throw new Error(`home missing hreflang seed: ${home.body.slice(home.body.indexOf('<head>'), home.body.indexOf('</head>') + 7)}`);
    }

    const zh = await get(`${baseUrl}/zh-hans/about`);
    if (zh.status !== 200 || !zh.body.includes('route-about')) {
        throw new Error(`GET /zh-hans/about want about page, got ${zh.status} ${zh.body.slice(0, 200)}`);
    }
    if (!zh.body.includes('lang="zh-hans"') || !zh.body.includes('data-vmz-locale="zh-hans"')) {
        throw new Error(`zh-hans about missing locale attrs: ${zh.body.slice(0, 300)}`);
    }
    // Link retains current LocaleId — IndexPage on zh page must be /zh-hans, not bare /.
    if (!zh.body.includes('data-vmz-route="IndexPage"') || !zh.body.includes('href="/zh-hans"')) {
        throw new Error(
            `zh-hans about Link must retain locale (IndexPage → /zh-hans): ${zh.body.slice(zh.body.indexOf('<main'), zh.body.indexOf('</main>') + 7)}`,
        );
    }

    const prefixedDefault = await get(`${baseUrl}/en-us/about`);
    if (prefixedDefault.status !== 302 || String(prefixedDefault.headers.location || '') !== '/about') {
        throw new Error(`omit-prefix default redirect want 302 /about, got ${prefixedDefault.status} ${prefixedDefault.headers.location}`);
    }

    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found for locale SPA proof (set VMZ_BROWSER)');
    const puppeteer = await loadPuppeteerCore();
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await page.goto(`${baseUrl}/about`, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForFunction('window.__vmzClientNavInstalled === true', { timeout: 10000 });
        await page.waitForFunction('typeof window.__vmzTransitionLocale === "function"', { timeout: 5000 });

        // Atomic LocaleTransition: en-us → zh-hans via host API (not hand-written path).
        const committed = await page.evaluate(async () => {
            const r = await (window as any).__vmzTransitionLocale('zh-hans');
            return {
                ...r,
                path: location.pathname,
                htmlLang: document.documentElement.lang,
                dataLocale: document.documentElement.getAttribute('data-locale'),
                appLocale: document.getElementById('app')?.getAttribute('data-vmz-locale'),
            };
        });
        if (committed.status !== 'committed' || committed.toLocale !== 'zh-hans') {
            throw new Error(`LocaleTransition commit failed: ${JSON.stringify(committed)}`);
        }
        if (committed.path !== '/zh-hans/about') {
            throw new Error(`LocaleTransition path want /zh-hans/about, got ${committed.path}`);
        }
        if (committed.htmlLang !== 'zh-hans' || committed.dataLocale !== 'zh-hans' || committed.appLocale !== 'zh-hans') {
            throw new Error(`LocaleTransition DOM commit incomplete: ${JSON.stringify(committed)}`);
        }

        // Unsupported locale must reject and keep zh-hans surface.
        const rejected = await page.evaluate(async () => {
            const before = document.documentElement.getAttribute('data-locale');
            const r = await (window as any).__vmzTransitionLocale('ja-jp');
            return {
                ...r,
                before,
                after: document.documentElement.getAttribute('data-locale'),
                path: location.pathname,
            };
        });
        if (rejected.status !== 'rejected' || rejected.after !== 'zh-hans' || rejected.path !== '/zh-hans/about') {
            throw new Error(`unsupported LocaleTransition must reject+retain: ${JSON.stringify(rejected)}`);
        }

        // Nav failure must soft-fail / roll back — keep zh-hans surface (no half commit, no full assign).
        const rolled = await page.evaluate(async () => {
            const before = document.documentElement.getAttribute('data-locale');
            const pathBefore = location.pathname;
            (window as any).__vmzClientNavSetFetch(async () => new Response('nope', { status: 503 }));
            const r = await (window as any).__vmzTransitionLocale('en-us');
            (window as any).__vmzClientNavSetFetch(null);
            return {
                ...r,
                before,
                after: document.documentElement.getAttribute('data-locale'),
                path: location.pathname,
                pathBefore,
            };
        });
        if (rolled.status !== 'rolled_back' || rolled.after !== 'zh-hans') {
            throw new Error(`LocaleTransition nav fail must roll back: ${JSON.stringify(rolled)}`);
        }
        if (rolled.path !== rolled.pathBefore || rolled.pathBefore !== '/zh-hans/about') {
            throw new Error(`rolled_back must not change pathname: ${JSON.stringify(rolled)}`);
        }
    } finally {
        await browser.close();
    }

    return 'artifact + SSR + Link retains locale + LocaleTransition commit/reject/rollback';
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

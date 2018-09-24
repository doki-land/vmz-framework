/**
 * A3-static — static profile: per-route HTML, real 404, SEO head,
 * sitemap/robots, StaticDeliveryManifest (no SPA fallback).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listenLocalStaticHost } from 'vmz';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { assertHashedCssImportsHttp } from '../_lib/assert-hashed-css-imports.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const ORIGIN = 'https://static.example.test';
const PORT = 18773;

function fail(msg: string): never {
    console.error(`static-delivery FAIL: ${msg}`);
    process.exit(1);
}

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
        });
        req.on('error', reject);
    });
}

console.log('static-delivery: vmz build --profile static…');
const example = path.join(root, ...EXAMPLE.split('/'));
const dist = path.join(example, 'dist', 'static');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--profile', 'static', '--origin', ORIGIN], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
const proof = readProof(root);
if (build.status !== 0) {
    upsertCheck(proof, {
        id: 'static-delivery.build',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    addLimitation(proof, 'A3: static build failed');
    writeProof(proof, root);
    fail(`vmz build --profile static exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const manifestPath = path.join(dist, '_vmz', 'static-delivery-manifest.json');
if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 'vmz.static.delivery_manifest.v0') {
    fail(`bad manifest schema: ${manifest.schema}`);
}
if (manifest.spaFallback !== false) fail('spaFallback must be false');
if (manifest.deliveryProfile !== 'static') fail(`deliveryProfile=${manifest.deliveryProfile}`);

const requiredHtml = [
    'index.html',
    path.join('about', 'index.html'),
    path.join('shop', 'index.html'),
    path.join('shop', 'offer', 'index.html'),
    path.join('welcome', 'index.html'),
    '404.html',
];
for (const rel of requiredHtml) {
    if (!fs.existsSync(path.join(dist, rel))) fail(`missing static HTML ${rel}`);
}
if (!fs.existsSync(path.join(dist, 'sitemap.xml'))) fail('missing sitemap.xml');
if (!fs.existsSync(path.join(dist, 'robots.txt'))) fail('missing robots.txt');

const home = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const about = fs.readFileSync(path.join(dist, 'about', 'index.html'), 'utf8');
const shop = fs.readFileSync(path.join(dist, 'shop', 'index.html'), 'utf8');
const notFound = fs.readFileSync(path.join(dist, '404.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8');

const errors: string[] = [];
if (!home.includes('route-home')) errors.push('index.html missing route-home');
if (!home.includes('<link rel="canonical" href="https://static.example.test/"')) {
    errors.push(`home missing canonical: ${home.slice(0, 500)}`);
}
if (!home.includes('<title>Home · Production Router</title>')) {
    errors.push(`home missing SEO title: ${home.slice(0, 400)}`);
}
if (!home.includes('name="robots" content="index,follow"')) errors.push('home missing robots meta');
if (!home.includes('hreflang="zh-hans"') || !home.includes('hreflang="x-default"') || !home.includes('hreflang="en-us"')) {
    errors.push(`home missing hreflang seed: ${home.slice(0, 800)}`);
}
if (!home.includes('lang="en-us"') || !home.includes('data-vmz-locale="en-us"')) {
    errors.push('home missing defaultLocale lang/data-vmz-locale');
}
const zhAbout = path.join(dist, 'zh-hans', 'about', 'index.html');
if (!fs.existsSync(zhAbout)) {
    errors.push('missing locale-prefixed static HTML zh-hans/about/index.html');
} else {
    const zhHtml = fs.readFileSync(zhAbout, 'utf8');
    if (!zhHtml.includes('lang="zh-hans"') || !zhHtml.includes('route-about')) {
        errors.push('zh-hans/about HTML missing locale/body');
    }
    if (!zhHtml.includes('hreflang="en-us"')) errors.push('zh-hans/about missing hreflang alternates');
}
if (!about.includes('route-about') || !about.includes('About · Production Router')) {
    errors.push('about HTML missing body/SEO');
}
if (!shop.includes('layout-shop') || !shop.includes('route-shop')) {
    errors.push('shop HTML missing layout+page');
}
if (!notFound.includes('route-static-404') || !notFound.includes('noindex')) {
    errors.push('404.html missing marker/noindex');
}
if (notFound.includes('route-home')) errors.push('404.html must not be SPA index fallback');
if (!sitemap.includes(`${ORIGIN}/`) || !sitemap.includes(`${ORIGIN}/about`)) {
    errors.push(`sitemap missing public urls: ${sitemap.slice(0, 400)}`);
}
if (!sitemap.includes(`${ORIGIN}/zh-hans/about`)) {
    errors.push(`sitemap missing locale-prefixed url: ${sitemap.slice(0, 600)}`);
}
if (sitemap.includes('/products/')) errors.push('sitemap must not include ServerRequired product routes');
const manifestLocales = (manifest.routes || []).filter((r: { localeId?: string }) => r.localeId === 'zh-hans');
if (manifestLocales.length < 1) {
    errors.push(`manifest missing zh-hans locale generations, got ${JSON.stringify((manifest.routes || []).slice(0, 8))}`);
}
if (!robots.includes('Sitemap:') || !robots.includes('Allow: /')) {
    errors.push(`robots.txt incomplete: ${robots}`);
}

const routes = manifest.routes || [];
if (!routes.some((r: { path: string }) => r.path === '/')) errors.push('manifest missing /');
if (!routes.some((r: { path: string }) => r.path === '/about')) errors.push('manifest missing /about');
if (!routes.some((r: { path: string }) => r.path === '/shop')) errors.push('manifest missing /shop');
if (!routes.some((r: { path: string }) => r.path === '/welcome')) errors.push('manifest missing explicit /welcome');
const skipped = manifest.skipped || [];
if (
    !skipped.some((s: { chunkId: string; classification: string }) => s.chunkId.includes('products') && s.classification === 'ServerRequired')
) {
    errors.push(`expected products/[id] skipped as ServerRequired, got ${JSON.stringify(skipped)}`);
}

// Serve static files only — prove deep links + real 404 (no SPA rewrite).
const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(dist, rel.replace(/^\//, '')));
    if (!file.startsWith(path.normalize(dist + path.sep)) && file !== path.normalize(dist)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const body = fs.readFileSync(file);
        const type = file.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : file.endsWith('.xml')
              ? 'application/xml'
              : file.endsWith('.txt')
                ? 'text/plain; charset=utf-8'
                : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(body);
        return;
    }
    // Real 404 document — never rewrite to index.html
    const body = fs.readFileSync(path.join(dist, '404.html'));
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
});

await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', () => resolve()));
try {
    const deep = await get(`http://127.0.0.1:${PORT}/about/`);
    const missing = await get(`http://127.0.0.1:${PORT}/no-such-route`);
    if (deep.status !== 200 || !deep.body.includes('route-about')) {
        errors.push(`deep link /about/ failed: ${deep.status}`);
    }
    if (missing.status !== 404 || !missing.body.includes('route-static-404')) {
        errors.push(`missing route want 404 document, got ${missing.status}`);
    }
    if (missing.body.includes('route-home')) {
        errors.push('404 must not SPA-fallback to home');
    }
} finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

upsertCheck(proof, {
    id: 'static-delivery.build',
    status: 'passed',
    detail: dist,
});
upsertCheck(proof, {
    id: 'static-delivery.html-routes',
    status: errors.some((e) => e.includes('HTML') || e.includes('index.html') || e.includes('shop')) ? 'failed' : 'passed',
    detail: 'per-route HTML + layout shop',
});
upsertCheck(proof, {
    id: 'static-delivery.seo',
    status: errors.some(
        (e) =>
            e.includes('canonical') ||
            e.includes('SEO') ||
            e.includes('sitemap') ||
            e.includes('robots') ||
            e.includes('hreflang') ||
            e.includes('locale'),
    )
        ? 'failed'
        : 'passed',
    detail: 'title/description/canonical/robots/hreflang + locale-prefixed HTML seed + sitemap/robots.txt',
});
upsertCheck(proof, {
    id: 'static-delivery.no-spa-fallback',
    status: errors.some((e) => e.includes('SPA') || e.includes('404')) ? 'failed' : 'passed',
    detail: '404.html distinct; static host returns 404 without index rewrite',
});
upsertCheck(proof, {
    id: 'static-delivery.manifest',
    status: errors.some((e) => e.includes('manifest')) ? 'failed' : 'passed',
    detail: manifest.manifestDigest,
});

proof.deliveryProfile = 'static';
const gaps = [
    'A3: Browser Production Profile / static v1 does not include StaticParameterized enumeration (explicit exclude; dynamic static param matrix deferred)',
];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('A3: CDN / provider adapters / StaticDeliveryManifest matrix not covered') &&
        !l.includes('A3: CDN provider adapters / cache-policy manifests not covered') &&
        !l.includes('A3: static / SEO') &&
        !l.includes('A3: static build failed') &&
        !l.includes('A3: content-addressed assets/<hash> immutable CDN layout not covered') &&
        !l.includes('A3: locale-prefixed static HTML / hreflang matrix not covered') &&
        !l.includes('SiteDeliveryContract resolver not covered') &&
        !l.includes('A3: StaticParameterized enumeration not covered'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log('static-delivery: hashed CSS @import HTTP (production-router)…');
const cdnPolicyPath = path.join(dist, '_vmz', 'cdn-policy-manifest.json');
if (!fs.existsSync(cdnPolicyPath)) fail(`missing ${cdnPolicyPath}`);
const cdnPolicy = JSON.parse(fs.readFileSync(cdnPolicyPath, 'utf8'));
const cssHost = await listenLocalStaticHost(dist, cdnPolicy, { host: '127.0.0.1', port: 18774 });
const cssErrors: string[] = [];
try {
    cssErrors.push(...(await assertHashedCssImportsHttp(dist, cssHost.baseUrl)));
} finally {
    await cssHost.close();
}
if (cssErrors.length) fail(cssErrors.join('\n'));
upsertCheck(proof, {
    id: 'static-delivery.css-import-http',
    status: 'passed',
    detail: 'production-router hashed vmz.css @import HTTP 200 text/css',
});
writeProof(proof, root);

// Nested @vmz/ui: official homepage static assemble (component registry preload).
console.log('static-delivery: homepage @vmz/ui static assemble…');
const homepage = path.join(root, 'packages/homepage');
const homepageDist = path.join(homepage, 'dist-static-conformance');
if (fs.existsSync(homepageDist)) {
    fs.rmSync(homepageDist, { recursive: true, force: true });
}
const hpBuild = spawnSync(
    process.execPath,
    [vmzBin(root), 'build', homepage, '--release', '--profile', 'static', '--origin', ORIGIN, '--out-dir', homepageDist],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: serveHostChildEnv() },
);
if (hpBuild.status !== 0) {
    fail(`homepage static build failed: ${hpBuild.status}\n${hpBuild.stdout}\n${hpBuild.stderr}`);
}
const hpIndex = path.join(homepageDist, 'index.html');
if (!fs.existsSync(hpIndex)) fail('homepage static missing index.html');
const hpHtml = fs.readFileSync(hpIndex, 'utf8');
if (!hpHtml.includes('<!DOCTYPE html>') && !hpHtml.includes('<html')) {
    fail('homepage index.html does not look like a document shell');
}
upsertCheck(proof, {
    id: 'static-delivery.ui-registry',
    status: 'passed',
    detail: 'homepage static assemble with @vmz/ui nested components',
});
console.log('static-delivery: hashed CSS @import HTTP (homepage)…');
const hpPolicyPath = path.join(homepageDist, '_vmz', 'cdn-policy-manifest.json');
if (!fs.existsSync(hpPolicyPath)) fail(`homepage missing ${hpPolicyPath}`);
const hpPolicy = JSON.parse(fs.readFileSync(hpPolicyPath, 'utf8'));
const hpCssHost = await listenLocalStaticHost(homepageDist, hpPolicy, { host: '127.0.0.1', port: 18775 });
const hpCssErrors: string[] = [];
try {
    hpCssErrors.push(...(await assertHashedCssImportsHttp(homepageDist, hpCssHost.baseUrl)));
} finally {
    await hpCssHost.close();
}
if (hpCssErrors.length) fail(hpCssErrors.join('\n'));
upsertCheck(proof, {
    id: 'static-delivery.css-import-http-homepage',
    status: 'passed',
    detail: 'homepage hashed vmz.css @import HTTP 200 text/css',
});
writeProof(proof, root);

console.log('static-delivery PASS: static HTML + 404 + SEO/hreflang + locale-prefixed seed + manifest (no SPA fallback)');
console.log('static-delivery NOTE: StaticParameterized explicitly excluded from this profile');

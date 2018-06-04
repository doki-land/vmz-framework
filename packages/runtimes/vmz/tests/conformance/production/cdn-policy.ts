/**
 * A3-cdn — vendor-neutral CDN policy + local static host + netlify projection.
 * Proves cdn-routing, cdn-cache-policy, static-resume assets, static-rollback.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CACHE_ASSET_IMMUTABLE, CACHE_HTML, listenLocalStaticHost, packRelease, publishRelease, readPointer, rollbackRelease } from 'vmz';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const ORIGIN = 'https://cdn.example.test';

function fail(msg: string): never {
    console.error(`cdn-policy FAIL: ${msg}`);
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

console.log('cdn-policy: vmz build --profile web-static…');
const example = path.join(root, ...EXAMPLE.split('/'));
const dist = path.join(example, 'dist');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--profile', 'web-static', '--origin', ORIGIN], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
const proof = readProof(root);
if (build.status !== 0) {
    upsertCheck(proof, {
        id: 'cdn-routing.build',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    writeProof(proof, root);
    fail(`web-static build failed: ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const policyPath = path.join(dist, '_vmz', 'cdn-policy-manifest.json');
if (!fs.existsSync(policyPath)) fail(`missing ${policyPath}`);
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
if (policy.schema !== 'vmz.cdn.policy_manifest.v0') fail(`bad policy schema ${policy.schema}`);
if (policy.spaFallback !== false) fail('spaFallback must be false');

const netlifyHeaders = path.join(dist, '_vmz', 'adapters', 'netlify', '_headers');
const netlifyRedirects = path.join(dist, '_vmz', 'adapters', 'netlify', '_redirects');
if (!fs.existsSync(netlifyHeaders) || !fs.existsSync(netlifyRedirects)) {
    fail('missing netlify adapter projection files');
}
const redirectsText = fs.readFileSync(netlifyRedirects, 'utf8');
if (/\*\s+\/index\.html/.test(redirectsText)) fail('netlify adapter must not SPA-fallback');
if (!redirectsText.includes('/home') || !redirectsText.includes('/')) {
    fail(`netlify _redirects missing /home → /: ${redirectsText}`);
}
const headersText = fs.readFileSync(netlifyHeaders, 'utf8');
if (!headersText.includes('Cache-Control')) fail('netlify _headers missing Cache-Control');

const errors: string[] = [];
const host = await listenLocalStaticHost(dist, policy, { host: '127.0.0.1', port: 18774 });

try {
    console.log('cdn-policy: routing + cache headers…');
    const home = await get(`${host.baseUrl}/`);
    const about = await get(`${host.baseUrl}/about/`);
    const alias = await get(`${host.baseUrl}/home`);
    const missing = await get(`${host.baseUrl}/no-such-route`);
    const assetsManifestPath = path.join(dist, '_vmz', 'content-addressed-assets.json');
    if (!fs.existsSync(assetsManifestPath)) fail('cdn-policy expects content-addressed-assets.json from web-static');
    const assetsManifest = JSON.parse(fs.readFileSync(assetsManifestPath, 'utf8'));
    const entryObj = (assetsManifest.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'entry-client.js');
    if (!entryObj?.assetPath) fail('missing hashed entry-client.js');
    const asset = await get(`${host.baseUrl}/${entryObj.assetPath}`);
    const logicalStill = await get(`${host.baseUrl}/entry-client.js`);
    const dom = await get(`${host.baseUrl}/vmz-dom.js`);

    if (home.status !== 200 || !home.body.includes('route-home')) {
        errors.push(`GET / want home HTML, got ${home.status}`);
    }
    if (String(home.headers['cache-control'] || '') !== CACHE_HTML) {
        errors.push(`HTML cache-control want ${CACHE_HTML}, got ${home.headers['cache-control']}`);
    }
    if (about.status !== 200 || !about.body.includes('route-about')) {
        errors.push(`deep /about/ failed: ${about.status}`);
    }
    if (alias.status !== 301 || String(alias.headers.location || '') !== '/') {
        errors.push(`cdn-routing /home want 301 Location=/, got ${alias.status} ${alias.headers.location}`);
    }

    // P5 prep: locale-prefixed CDN HTML + LocaleId cache keys + hreflang (no Accept-Language steal).
    console.log('cdn-policy: locale cache-key / hreflang matrix…');
    if (policy.localeCache?.varyAcceptLanguage !== false) {
        errors.push('localeCache.varyAcceptLanguage must be false');
    }
    if (!Array.isArray(policy.localeCache?.locales) || !policy.localeCache.locales.includes('zh-hans')) {
        errors.push(`localeCache.locales missing zh-hans: ${JSON.stringify(policy.localeCache)}`);
    }
    const aboutEn = (policy.routes || []).find(
        (r: { path?: string; localeId?: string }) => r.path === '/about' && r.localeId === 'en-us',
    );
    const aboutZh = (policy.routes || []).find(
        (r: { path?: string; localeId?: string }) => r.path === '/zh-hans/about' && r.localeId === 'zh-hans',
    );
    if (!aboutEn?.cacheKey || !String(aboutEn.cacheKey).includes('locale=en-us')) {
        errors.push(`CDN about en-us cacheKey missing locale=: ${JSON.stringify(aboutEn)}`);
    }
    if (!aboutZh?.cacheKey || !String(aboutZh.cacheKey).includes('locale=zh-hans')) {
        errors.push(`CDN about zh-hans cacheKey missing locale=: ${JSON.stringify(aboutZh)}`);
    }
    if (aboutEn?.varyAcceptLanguage !== false || aboutZh?.varyAcceptLanguage !== false) {
        errors.push('locale HTML routes must set varyAcceptLanguage=false');
    }
    if (!aboutEn?.hreflang?.some((a: { hreflang?: string }) => a.hreflang === 'zh-hans')) {
        errors.push(`CDN about en-us missing hreflang zh-hans: ${JSON.stringify(aboutEn?.hreflang)}`);
    }
    if (!aboutZh?.hreflang?.some((a: { hreflang?: string }) => a.hreflang === 'x-default')) {
        errors.push(`CDN about zh-hans missing hreflang x-default: ${JSON.stringify(aboutZh?.hreflang)}`);
    }
    const zhAbout = await get(`${host.baseUrl}/zh-hans/about/`);
    if (zhAbout.status !== 200 || !zhAbout.body.includes('route-about')) {
        errors.push(`locale CDN /zh-hans/about/ failed: ${zhAbout.status}`);
    }
    if (!zhAbout.body.includes('lang="zh-hans"') || !zhAbout.body.includes('hreflang="en-us"')) {
        errors.push(`locale CDN HTML missing lang/hreflang: ${zhAbout.body.slice(0, 500)}`);
    }
    if (String(zhAbout.headers['cache-control'] || '') !== CACHE_HTML) {
        errors.push(`locale HTML cache-control want ${CACHE_HTML}, got ${zhAbout.headers['cache-control']}`);
    }
    const omitDefault = await get(`${host.baseUrl}/en-us/about`);
    if (omitDefault.status !== 301 || String(omitDefault.headers.location || '') !== '/about') {
        errors.push(
            `omit-prefix CDN redirect want 301 /about, got ${omitDefault.status} ${omitDefault.headers.location}`,
        );
    }
    if (!redirectsText.includes('/en-us/about') || !redirectsText.includes('/about')) {
        errors.push(`netlify _redirects missing omit-prefix /en-us/about → /about: ${redirectsText}`);
    }
    if (missing.status !== 404 || !missing.body.includes('route-static-404')) {
        errors.push(`error document want 404, got ${missing.status}`);
    }
    if (missing.body.includes('route-home')) errors.push('404 must not SPA-fallback to home');
    if (String(missing.headers['x-robots-tag'] || '').includes('noindex') === false) {
        errors.push(`404 missing x-robots-tag noindex, got ${missing.headers['x-robots-tag']}`);
    }

    if (asset.status !== 200 || !asset.body) errors.push('hashed entry-client missing (static-resume)');
    // Split DOM runtime: barrel vmz-dom.js + companions (dom-ssr.js carries renderToStream).
    const domSsr = await get(`${host.baseUrl}/dom-ssr.js`);
    if (dom.status !== 200 || !/dom-ssr\.js/.test(dom.body)) {
        errors.push('vmz-dom.js missing/corrupt barrel (static-resume)');
    }
    if (domSsr.status !== 200 || !domSsr.body.includes('renderToStream')) {
        errors.push('dom-ssr.js missing/corrupt (static-resume)');
    }
    if (String(asset.headers['cache-control'] || '') !== CACHE_ASSET_IMMUTABLE) {
        errors.push(`asset cache want immutable, got ${asset.headers['cache-control']}`);
    }
    if (!home.body.includes(entryObj.assetPath)) {
        errors.push('static HTML must reference hashed assets/<hash> entry for resume');
    }
    if (home.body.includes('src="/entry-client.js"')) {
        errors.push('static HTML must not keep logical /entry-client.js after content-address rewrite');
    }
    // Logical path may remain for serve/dev coexistence; hashed path is the publish URL.
    if (logicalStill.status !== 200) {
        errors.push('logical entry-client.js should remain for non-static serve coexistence');
    }

    console.log('cdn-policy: static-rollback via release pointers…');
    // Must sit beside dist — fs.cpSync cannot snapshot dist into a child of itself.
    const releasesRoot = path.join(path.dirname(dist), '.vmz-cdn-releases');
    fs.rmSync(releasesRoot, { recursive: true, force: true });
    const envA = packRelease(dist, { applicationId: 'production-router-cdn' });
    publishRelease(releasesRoot, dist, envA);
    const indexHtml = path.join(dist, 'index.html');
    const originalHtml = fs.readFileSync(indexHtml, 'utf8');
    fs.writeFileSync(indexHtml, `${originalHtml}\n<!-- cdn-mutate ${Date.now()} -->\n`, 'utf8');
    const envB = packRelease(dist, { applicationId: 'production-router-cdn' });
    if (envB.artifactDigest === envA.artifactDigest) errors.push('mutated static HTML must change digest');
    publishRelease(releasesRoot, dist, envB);
    if (readPointer(path.join(releasesRoot, 'CURRENT')) !== envB.artifactDigest) {
        errors.push('CURRENT not B after publish');
    }
    const rb = rollbackRelease(releasesRoot);
    if (rb.restored !== envA.artifactDigest) errors.push(`rollback restored ${rb.restored}`);
    // Restore workspace dist from release A snapshot for host re-check
    const snapA = path.join(releasesRoot, envA.artifactDigest, 'dist');
    if (!fs.existsSync(path.join(snapA, 'index.html'))) {
        errors.push('release A snapshot missing index.html');
    } else {
        const restored = fs.readFileSync(path.join(snapA, 'index.html'), 'utf8');
        if (restored.includes('cdn-mutate')) errors.push('rollback snapshot still has mutate marker');
        if (!restored.includes('route-home')) errors.push('rollback snapshot missing route-home');
    }
} finally {
    await host.close();
}

upsertCheck(proof, {
    id: 'cdn-routing',
    status: errors.some((e) => e.includes('cdn-routing') || e.includes('/home') || e.includes('deep')) ? 'failed' : 'passed',
    detail: 'local-static + netlify projection: /home→/ ; deep links; no SPA fallback',
});
upsertCheck(proof, {
    id: 'cdn-cache-policy',
    status: errors.some((e) => e.includes('cache') && !e.includes('locale')) ? 'failed' : 'passed',
    detail: `HTML=${CACHE_HTML}; assets=${CACHE_ASSET_IMMUTABLE}`,
});
upsertCheck(proof, {
    id: 'cdn-locale-hreflang',
    status: errors.some(
        (e) =>
            e.includes('locale') ||
            e.includes('hreflang') ||
            e.includes('omit-prefix') ||
            e.includes('cacheKey') ||
            e.includes('varyAcceptLanguage'),
    )
        ? 'failed'
        : 'passed',
    detail: 'locale-prefixed HTML + LocaleId cacheKey + hreflang + omit-prefix CDN redirect',
});
upsertCheck(proof, {
    id: 'static-resume',
    status: errors.some((e) => e.includes('static-resume') || e.includes('entry-client') || e.includes('vmz-dom')) ? 'failed' : 'passed',
    detail: 'static HTML references resume assets; immutable cache on js',
});
upsertCheck(proof, {
    id: 'static-rollback',
    status: errors.some((e) => e.includes('rollback') || e.includes('digest') || e.includes('CURRENT') || e.includes('mutate'))
        ? 'failed'
        : 'passed',
    detail: 'web-static artifact pack + CURRENT/PREVIOUS rollback',
});

const gaps = ['A3: second real CDN provider adapter beyond netlify projection not covered'];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('A3: CDN provider adapters / cache-policy manifests not covered') &&
        !l.includes('A3: CDN / provider adapters / cache-policy manifests not covered') &&
        !l.includes('A3: SiteDeliveryContract embedded/filesystem/remote not covered') &&
        !l.includes('A3: content-addressed assets/<hash> layout not covered') &&
        !l.includes('A3: locale-prefixed CDN cache keys / hreflang not covered'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log('cdn-policy PASS: routing + cache + locale/hreflang + resume assets + rollback');
console.log('cdn-policy NOTE: second CDN provider adapter still open');

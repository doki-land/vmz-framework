/**
 * A3 content-addressed assets/<hash> — immutable CDN object layout.
 * verify id: content-addressed-assets
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CACHE_ASSET_IMMUTABLE, CACHE_HTML, assertSharedAssetPath, listenLocalStaticHost, resolveAssetByDigest } from 'vmz';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';
import { assertHashedCssImportsHttp } from '../_lib/assert-hashed-css-imports.ts';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const ORIGIN = 'https://assets.example.test';

function fail(msg: string): never {
    console.error(`content-addressed-assets FAIL: ${msg}`);
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

console.log('content-addressed-assets: vmz build --profile static…');
const example = path.join(root, ...EXAMPLE.split('/'));
const dist = path.join(example, 'dist');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--profile', 'static', '--origin', ORIGIN], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
const proof = readProof(root);
if (build.status !== 0) {
    upsertCheck(proof, {
        id: 'content-addressed-assets',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    writeProof(proof, root);
    fail(`static build failed: ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const errors: string[] = [];
const assetsManifestPath = path.join(dist, '_vmz', 'content-addressed-assets.json');
if (!fs.existsSync(assetsManifestPath)) errors.push('missing _vmz/content-addressed-assets.json');
const assetsManifest = fs.existsSync(assetsManifestPath) ? JSON.parse(fs.readFileSync(assetsManifestPath, 'utf8')) : null;
if (assetsManifest?.schema !== 'vmz.content_addressed_assets.v0') {
    errors.push(`bad assets schema ${assetsManifest?.schema}`);
}
if (!assetsManifest?.objectCount || assetsManifest.objectCount < 1) {
    errors.push('expected hashed objects');
}

const entry = (assetsManifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'entry-client.js');
if (!entry?.assetPath?.startsWith('assets/') || !entry.digest) {
    errors.push('entry-client.js not content-addressed');
} else if (!fs.existsSync(path.join(dist, ...String(entry.assetPath).split('/')))) {
    errors.push(`missing hashed file ${entry.assetPath}`);
}

const home = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (home.includes('/entry-client.js"') || home.includes("'/entry-client.js'")) {
    errors.push('index.html still references /entry-client.js');
}
if (entry && !home.includes(`/${entry.assetPath}`)) {
    errors.push(`index.html missing hashed entry ${entry.assetPath}`);
}

const vmzCssObj = (assetsManifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'vmz.css');
if (vmzCssObj?.assetPath) {
    const hashedCss = fs.readFileSync(path.join(dist, ...String(vmzCssObj.assetPath).split('/')), 'utf8');
    if (hashedCss.includes('vmz-designs.css') || hashedCss.includes('vmz-style.css')) {
        errors.push('hashed vmz.css still contains unrewritten logical @import paths');
    }
    const designs = (assetsManifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'vmz-designs.css');
    const style = (assetsManifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'vmz-style.css');
    if (designs && !hashedCss.includes(path.basename(String(designs.assetPath)))) {
        errors.push('hashed vmz.css missing hashed vmz-designs import');
    }
    if (style && fs.existsSync(path.join(dist, 'vmz-style.css')) && !hashedCss.includes(path.basename(String(style.assetPath)))) {
        errors.push('hashed vmz.css missing hashed vmz-style import');
    }
}
if (fs.existsSync(path.join(dist, 'vmz-style.css'))) {
    const styleObj = (assetsManifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'vmz-style.css');
    if (!styleObj?.assetPath) errors.push('vmz-style.css not content-addressed');
}

const staticManifest = JSON.parse(fs.readFileSync(path.join(dist, '_vmz', 'static-delivery-manifest.json'), 'utf8'));
if (!staticManifest.contentAddressedAssets?.manifestDigest) {
    errors.push('StaticDeliveryManifest missing contentAddressedAssets link');
}

console.log('content-addressed-assets: digest reuse…');
const share = assertSharedAssetPath(dist, 'reuse-payload-v1', 'reuse-payload-v1', '.js');
if (!share.ok) errors.push(`shared path failed: ${share.reason}`);
const resolved = share.digest ? resolveAssetByDigest(dist, share.digest, '.js') : null;
if (!resolved || resolved.assetPath !== share.assetPath) {
    errors.push('resolveAssetByDigest missed shared object');
}

console.log('content-addressed-assets: CDN immutable headers…');
const policy = JSON.parse(fs.readFileSync(path.join(dist, '_vmz', 'cdn-policy-manifest.json'), 'utf8'));
const host = await listenLocalStaticHost(dist, policy, { host: '127.0.0.1', port: 18776 });
try {
    const html = await get(`${host.baseUrl}/`);
    if (String(html.headers['cache-control'] || '') !== CACHE_HTML) {
        errors.push(`HTML cache want revalidate, got ${html.headers['cache-control']}`);
    }
    if (entry) {
        const asset = await get(`${host.baseUrl}/${entry.assetPath}`);
        if (asset.status !== 200) errors.push(`GET /${entry.assetPath} status ${asset.status}`);
        if (String(asset.headers['cache-control'] || '') !== CACHE_ASSET_IMMUTABLE) {
            errors.push(`hashed asset cache want immutable, got ${asset.headers['cache-control']}`);
        }
    }
    console.log('content-addressed-assets: hashed CSS @import HTTP…');
    errors.push(...(await assertHashedCssImportsHttp(dist, host.baseUrl, get)));
} finally {
    await host.close();
}

upsertCheck(proof, {
    id: 'content-addressed-assets',
    status: errors.length ? 'failed' : 'passed',
    detail: entry
        ? `layout=assets/<sha256>.* objects=${assetsManifest.objectCount} entry=${String(entry.digest).slice(0, 12)}`
        : errors.join('; '),
});
upsertCheck(proof, {
    id: 'content-addressed-assets.reuse',
    status: share.ok ? 'passed' : 'failed',
    detail: share.assetPath || share.reason,
});
upsertCheck(proof, {
    id: 'content-addressed-assets.cdn-immutable',
    status: errors.some((e) => e.includes('cache') || e.includes('immutable')) ? 'failed' : 'passed',
    detail: CACHE_ASSET_IMMUTABLE,
});
upsertCheck(proof, {
    id: 'content-addressed-assets.css-import-http',
    status: errors.some((e) => e.includes('@import') || e.includes('text/css') || e.includes('vmz.css')) ? 'failed' : 'passed',
    detail: 'hashed vmz.css @import siblings 200 text/css',
});

const gaps = ['A3: second real CDN provider adapter beyond netlify projection not covered'];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('A3: content-addressed assets/<hash>') &&
        !l.includes('content-addressed assets/<hash> immutable') &&
        !l.includes('content-addressed assets/<hash> cross-source') &&
        !l.includes('A3: locale-prefixed CDN cache keys / hreflang not covered'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log(`content-addressed-assets PASS: objects=${assetsManifest.objectCount} entry=${String(entry?.digest || '').slice(0, 12)}`);
console.log('content-addressed-assets NOTE: second CDN provider adapter still open');

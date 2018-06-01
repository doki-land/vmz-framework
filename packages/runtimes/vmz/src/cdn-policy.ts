/**
 * A3-cdn: vendor-neutral CDN policy (cache / redirect / error) + local static host.
 * Provider adapters only project the same contract — they must not change RouteId/canonical/CSP.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const CDN_POLICY_MANIFEST_SCHEMA = 'vmz.cdn.policy_manifest.v0';
export const CDN_ADAPTER_PROJECTION_SCHEMA = 'vmz.cdn.adapter_projection.v0';

/** HTML: revalidate. Hashed/static assets: long immutable. */
export const CACHE_HTML = 'public, max-age=0, must-revalidate';
export const CACHE_ASSET_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_META = 'public, max-age=3600';

/**
 * Build CDNPolicyManifest from StaticDeliveryManifest (+ optional redirects).
 * @param {Record<string, any>} staticManifest
 * @param {{ redirects?: Array<{ from: string, to: string, status?: number, reason?: string }> }} [opts]
 */
export function buildCdnPolicyManifest(staticManifest, opts = {}) {
    const origin = String(staticManifest.origin || '');
    const redirects = [{ from: '/home', to: '/', status: 301, reason: 'canonical-alias' }, ...(opts.redirects || [])];
    const headers = [
        { match: '**/*.html', headers: { 'cache-control': CACHE_HTML } },
        {
            match: '**/404.html',
            headers: { 'cache-control': CACHE_HTML, 'x-robots-tag': 'noindex, nofollow' },
        },
        // Content-addressed immutable objects (A3 assets/<hash>).
        { match: '**/assets/**', headers: { 'cache-control': CACHE_ASSET_IMMUTABLE } },
        { match: '**/*.{js,css,mjs}', headers: { 'cache-control': CACHE_ASSET_IMMUTABLE } },
        { match: '**/sitemap.xml', headers: { 'cache-control': CACHE_META } },
        { match: '**/robots.txt', headers: { 'cache-control': CACHE_META } },
    ];
    const errorDocuments = Array.isArray(staticManifest.errorDocuments) ? staticManifest.errorDocuments : [{ status: 404, path: '404.html' }];

    const body = {
        schema: CDN_POLICY_MANIFEST_SCHEMA,
        applicationId: staticManifest.applicationId || null,
        deliveryProfile: 'web-static',
        origin,
        spaFallback: false,
        staticManifestDigest: staticManifest.manifestDigest || null,
        redirects,
        headers,
        errorDocuments,
        routes: (staticManifest.routes || []).map((r) => ({
            routeId: r.routeId,
            path: r.path,
            htmlPath: r.htmlPath,
            canonical: r.seo?.canonical || null,
        })),
    };
    body.policyDigest = sha256Hex(canonicalJson(body));
    return body;
}

/**
 * Write CDN policy + adapter projections under dist/_vmz.
 * @param {string} distDir
 * @param {Record<string, any>} staticManifest
 * @param {{ redirects?: Array<{ from: string, to: string, status?: number, reason?: string }> }} [opts]
 */
export function emitCdnPolicy(distDir, staticManifest, opts = {}) {
    const policy = buildCdnPolicyManifest(staticManifest, opts);
    const vmzDir = path.join(distDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    fs.writeFileSync(path.join(vmzDir, 'cdn-policy-manifest.json'), `${JSON.stringify(policy, null, 2)}\n`, 'utf8');

    const local = projectCdnAdapter(policy, 'local-static');
    const netlify = projectCdnAdapter(policy, 'netlify');
    const adaptersDir = path.join(vmzDir, 'adapters');
    fs.mkdirSync(path.join(adaptersDir, 'local-static'), { recursive: true });
    fs.mkdirSync(path.join(adaptersDir, 'netlify'), { recursive: true });
    fs.writeFileSync(path.join(adaptersDir, 'local-static', 'projection.json'), `${JSON.stringify(local, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(adaptersDir, 'netlify', 'projection.json'), `${JSON.stringify(netlify, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(adaptersDir, 'netlify', '_headers'), String(netlify.files['_headers'] || ''), 'utf8');
    fs.writeFileSync(path.join(adaptersDir, 'netlify', '_redirects'), String(netlify.files['_redirects'] || ''), 'utf8');

    return { policy, adapters: { 'local-static': local, netlify } };
}

/**
 * Project vendor-neutral policy to an adapter. Must preserve redirect targets and forbid SPA fallback.
 * @param {Record<string, any>} policy
 * @param {'local-static' | 'netlify'} adapterId
 */
export function projectCdnAdapter(policy, adapterId) {
    if (policy.spaFallback) {
        throw new Error('projectCdnAdapter: spaFallback=true is forbidden');
    }
    if (adapterId === 'local-static') {
        return {
            schema: CDN_ADAPTER_PROJECTION_SCHEMA,
            adapterId: 'local-static',
            policyDigest: policy.policyDigest,
            host: 'vmz-local-static',
            spaFallback: false,
            redirects: policy.redirects,
            headers: policy.headers,
            errorDocuments: policy.errorDocuments,
            files: {},
        };
    }
    if (adapterId === 'netlify') {
        const headerLines = [];
        for (const rule of policy.headers || []) {
            const glob = netlifyGlob(rule.match);
            headerLines.push(glob);
            for (const [k, v] of Object.entries(rule.headers || {})) {
                headerLines.push(`  ${headerCase(k)}: ${v}`);
            }
        }
        const redirectLines = [];
        for (const r of policy.redirects || []) {
            redirectLines.push(`${r.from}  ${r.to}  ${Number(r.status) || 301}`);
        }
        // Explicit only — never `/* /index.html 200`
        const redirectsText = redirectLines.join('\n') + (redirectLines.length ? '\n' : '');
        if (/\*\s+\/index\.html/.test(redirectsText)) {
            throw new Error('netlify adapter refused SPA fallback redirect');
        }
        return {
            schema: CDN_ADAPTER_PROJECTION_SCHEMA,
            adapterId: 'netlify',
            policyDigest: policy.policyDigest,
            host: 'netlify',
            spaFallback: false,
            redirects: policy.redirects,
            headers: policy.headers,
            errorDocuments: policy.errorDocuments,
            files: {
                _headers: headerLines.join('\n') + '\n',
                _redirects: redirectsText,
            },
        };
    }
    throw new Error(`unknown CDN adapter ${adapterId}`);
}

/**
 * Local static host that applies CDNPolicyManifest (redirects, cache headers, 404 doc).
 * @param {string} distDir
 * @param {Record<string, any>} policy
 * @param {{ host?: string, port?: number }} [opts]
 * @returns {Promise<{ host: string, port: number, baseUrl: string, close: () => Promise<void> }>}
 */
export function listenLocalStaticHost(distDir, policy, opts = {}) {
    const host = opts.host || '127.0.0.1';
    const port = Number(opts.port || 0);
    const handler = createLocalStaticHandler(distDir, policy);
    const server = http.createServer(handler);
    return new Promise((resolve, reject) => {
        server.listen(port, host, () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            resolve({
                host,
                port: actualPort,
                baseUrl: `http://${host}:${actualPort}`,
                close: () =>
                    new Promise((res, rej) => {
                        server.close((err) => (err ? rej(err) : res()));
                    }),
            });
        });
        server.on('error', reject);
    });
}

/**
 * @param {string} distDir
 * @param {Record<string, any>} policy
 */
export function createLocalStaticHandler(distDir, policy) {
    const root = path.resolve(distDir);
    return (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
            let pathname = decodeURIComponent(url.pathname || '/');

            const redirect = matchRedirect(policy.redirects || [], pathname);
            if (redirect) {
                const status = Number(redirect.status) || 301;
                const headers = applyHeaderRules(policy.headers || [], pathname, {
                    Location: redirect.to,
                });
                res.writeHead(status, headers);
                res.end();
                return;
            }

            let rel = pathname;
            if (rel.endsWith('/')) rel += 'index.html';
            if (rel === '/') rel = '/index.html';
            const file = safeJoin(root, rel.replace(/^\//, ''));
            if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
                const body = fs.readFileSync(file);
                const type = contentType(file);
                const headers = applyHeaderRules(policy.headers || [], rel, {
                    'content-type': type,
                });
                res.writeHead(200, headers);
                res.end(body);
                return;
            }

            const errDoc = (policy.errorDocuments || []).find((e) => Number(e.status) === 404);
            const errPath = errDoc?.path || '404.html';
            const abs404 = path.join(root, errPath);
            if (fs.existsSync(abs404)) {
                const body = fs.readFileSync(abs404);
                const headers = applyHeaderRules(policy.headers || [], `/${errPath}`, {
                    'content-type': 'text/html; charset=utf-8',
                });
                res.writeHead(404, headers);
                res.end(body);
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
        } catch (err) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(err instanceof Error ? err.message : String(err));
        }
    };
}

/**
 * @param {Array<{ from: string, to: string, status?: number }>} redirects
 * @param {string} pathname
 */
function matchRedirect(redirects, pathname) {
    const p = pathname.replace(/\/+$/, '') || '/';
    for (const r of redirects) {
        const from = String(r.from || '').replace(/\/+$/, '') || '/';
        if (from === p || from === pathname) return r;
    }
    return null;
}

/**
 * @param {Array<{ match: string, headers: Record<string, string> }>} rules
 * @param {string} pathname
 * @param {Record<string, string>} base
 */
function applyHeaderRules(rules, pathname, base = {}) {
    /** @type {Record<string, string>} */
    const out = { ...base };
    for (const rule of rules) {
        if (matchGlob(rule.match, pathname)) {
            Object.assign(out, rule.headers || {});
        }
    }
    return out;
}

/**
 * Minimal glob matcher for CDN header rules (html / js|css|mjs / exact / prefix).
 * @param {string} pattern
 * @param {string} pathname
 */
export function matchGlob(pattern, pathname) {
    const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const pat = String(pattern || '');
    if (pat === '**/*.html') return p.endsWith('.html');
    if (pat === '**/404.html') return p === '/404.html' || p.endsWith('/404.html');
    if (pat === '**/assets/**') return p === '/assets' || p.startsWith('/assets/');
    if (pat === '**/*.{js,css,mjs}') return /\.(js|css|mjs)$/.test(p);
    if (pat === '**/sitemap.xml') return p.endsWith('/sitemap.xml') || p === '/sitemap.xml';
    if (pat === '**/robots.txt') return p.endsWith('/robots.txt') || p === '/robots.txt';
    if (pat.endsWith('/**')) {
        const prefix = pat.slice(0, -3);
        // Only treat as path prefix when pattern is absolute-ish (starts with / or bare segment).
        if (prefix.startsWith('/')) {
            return p === prefix || p.startsWith(prefix + '/');
        }
        if (!prefix.includes('*')) {
            return p === `/${prefix}` || p.startsWith(`/${prefix}/`);
        }
    }
    return p === pat || p === `/${pat.replace(/^\//, '')}`;
}

function netlifyGlob(match) {
    if (match === '**/*.html') return '/*.html';
    if (match === '**/404.html') return '/404.html';
    if (match === '**/assets/**') return '/assets/*';
    if (match === '**/*.{js,css,mjs}') return '/*.{js,css,mjs}';
    if (match === '**/sitemap.xml') return '/sitemap.xml';
    if (match === '**/robots.txt') return '/robots.txt';
    return match.startsWith('/') ? match : `/${match}`;
}

function headerCase(name) {
    return String(name)
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('-');
}

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.xml')) return 'application/xml';
    if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
    if (file.endsWith('.json')) return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

/**
 * @param {string} root
 * @param {string} rel
 */
function safeJoin(root, rel) {
    const full = path.resolve(root, rel);
    const normRoot = path.resolve(root);
    if (full !== normRoot && !full.startsWith(normRoot + path.sep)) return null;
    return full;
}

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
        return out;
    }
    return value;
}

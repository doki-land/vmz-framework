/**
 * A3-static: emit per-route HTML + 404 + SEO head + StaticDeliveryManifest.
 * Reuses the same Direct SSR path as serve-host (no second SSG runtime).
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitCdnPolicy } from './cdn-policy.js';
import { emitContentAddressedAssets } from './content-addressed-assets.js';
import { absoluteUrl, buildLocalePageMeta, localizeBodyLinks } from './locale-router.js';
import { requireNativeAddon } from './native-addon.js';

export const STATIC_DELIVERY_MANIFEST_SCHEMA = 'vmz.static.delivery_manifest.v0';

/**
 * @param {string} distDir
 * @param {{
 *   origin?: string,
 *   applicationId?: string,
 *   staticParams?: Record<string, Array<Record<string, string>>>,
 * }} [opts]
 */
export async function emitWebStatic(distDir, opts = {}) {
    const origin = String(opts.origin || process.env.VMZ_SITE_ORIGIN || 'https://example.test').replace(/\/$/, '');
    const applicationId = opts.applicationId || path.basename(path.dirname(distDir));

    const domPath = path.join(distDir, 'vmz-dom.js');
    if (!fs.existsSync(domPath)) {
        throw new Error(`emitWebStatic: missing ${domPath} — run vmz build first`);
    }
    const { renderToString, renderToStream } = await import(pathToFileURL(domPath).href);

    const pageCatalog = listPageClientFiles(distDir);
    /** @type {Array<{
     *   routeId: string,
     *   path: string,
     *   chunkId: string,
     *   htmlPath: string,
     *   classification: string,
     *   title: string,
     *   description: string,
     *   canonical: string,
     *   robots: string,
     * }>} */
    const generations = [];
    /** @type {Array<{ routeId: string, path: string, chunkId: string, classification: string, reason: string }>} */
    const skipped = [];

    for (const page of pageCatalog) {
        const pattern = patternFromSegs(page.segs);
        const routeId = guessRouteId(distDir, page.chunkId);
        if (page.segs.some((s) => s.kind === 'param' || s.kind === 'catch')) {
            skipped.push({
                routeId,
                path: pattern,
                chunkId: page.chunkId,
                classification: 'ServerRequired',
                reason: 'dynamic params require explicit StaticRouteSource (not in this thin slice)',
            });
            continue;
        }

        const Page = await loadCtor(distDir, page.chunkId);
        if (!Page) {
            skipped.push({
                routeId,
                path: pattern,
                chunkId: page.chunkId,
                classification: 'UnsupportedForStatic',
                reason: 'missing page ctor',
            });
            continue;
        }

        const params = {};
        if (typeof Page.access === 'function') {
            const access = await Page.access({ params, pathname: pattern, chunkId: page.chunkId, method: 'GET' });
            const kind = access && typeof access === 'object' ? String(access.kind || 'allow') : 'allow';
            if (kind !== 'allow') {
                skipped.push({
                    routeId,
                    path: pattern,
                    chunkId: page.chunkId,
                    classification: 'ServerRequired',
                    reason: `access result ${kind} is request-bound`,
                });
                continue;
            }
        }

        let props = { ...params };
        if (typeof Page.load === 'function') {
            const loaded = await Page.load({
                params,
                pathname: pattern,
                chunkId: page.chunkId,
                searchParams: new URLSearchParams(),
            });
            if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
                props = { ...props, ...loaded };
            }
        }

        const meta = await resolvePageMeta(Page, { params, props, pathname: pattern, origin });
        const layoutChain = resolveLayoutChain(distDir, page.chunkId);
        let bodyHtml = '';
        for await (const chunk of renderToStream(Page, props, {})) {
            bodyHtml += chunk;
        }
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const Layout = await loadCtor(distDir, layoutChain[i]);
            if (!Layout) continue;
            bodyHtml = await renderToString(Layout, {}, { slotHtml: bodyHtml });
        }

        const localeArt = loadLocaleArtifact(distDir);
        // Locale artifact routeId is chunkId (`pages/about`), not the page class name.
        const localeWrites = expandLocaleStaticGenerations({
            localeArt,
            routeId: page.chunkId,
            chunkId: page.chunkId,
            pattern,
            origin,
            baseMeta: meta,
        });

        for (const gen of localeWrites) {
            const absHtml = path.join(distDir, gen.htmlPath);
            fs.mkdirSync(path.dirname(absHtml), { recursive: true });
            // Each LocaleId HTML must retain locale on same-app Links (realization authority).
            const localizedBody = gen.localeId && localeArt ? localizeBodyLinks(bodyHtml, gen.localeId, localeArt) : bodyHtml;
            const html = wrapDocument({
                bodyHtml: localizedBody,
                chunkId: page.chunkId,
                layoutChain,
                props,
                meta: gen.meta,
                cssEntry: readCssEntry(distDir),
            });
            fs.writeFileSync(absHtml, html, 'utf8');
            generations.push({
                routeId,
                path: gen.path,
                chunkId: page.chunkId,
                htmlPath: gen.htmlPath.replaceAll('\\', '/'),
                classification: 'Static',
                title: gen.meta.title,
                description: meta.description,
                canonical: gen.meta.canonical,
                robots: gen.meta.robots,
                localeId: gen.localeId || null,
                alternates: Array.isArray(gen.meta.alternates) ? gen.meta.alternates : [],
            });
        }
    }

    const notFoundHtml = wrapDocument({
        bodyHtml: '<main><h1>Not Found</h1><p>route-static-404</p></main>',
        chunkId: '',
        layoutChain: [],
        props: {},
        meta: {
            title: 'Not Found',
            description: 'Page not found',
            canonical: `${origin}/404`,
            robots: 'noindex,nofollow',
            lang: 'en',
        },
        cssEntry: readCssEntry(distDir),
        isErrorDocument: true,
    });
    fs.writeFileSync(path.join(distDir, '404.html'), notFoundHtml, 'utf8');

    const sitemap = buildSitemap(origin, generations);
    fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap, 'utf8');
    const robots = `User-agent: *\nAllow: /\nDisallow: /404\nSitemap: ${origin}/sitemap.xml\n`;
    fs.writeFileSync(path.join(distDir, 'robots.txt'), robots, 'utf8');

    // Hard rule: no SPA fallback shim in artifact.
    for (const bad of ['_redirects', 'vercel.json', 'netlify.toml']) {
        const p = path.join(distDir, bad);
        if (fs.existsSync(p)) {
            const text = fs.readFileSync(p, 'utf8');
            if (/\/\*|\bspa\b|index\.html/i.test(text) && /fallback|rewrite|redirects/i.test(text)) {
                throw new Error(`emitWebStatic: forbidden SPA fallback config present: ${bad}`);
            }
        }
    }

    const vmzDir = path.join(distDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    const manifest = {
        schema: STATIC_DELIVERY_MANIFEST_SCHEMA,
        applicationId,
        deliveryProfile: 'web-static',
        origin,
        generatedAt: new Date().toISOString(),
        spaFallback: false,
        errorDocuments: [{ status: 404, path: '404.html' }],
        routes: generations.map((g) => ({
            routeId: g.routeId,
            path: g.path,
            chunkId: g.chunkId,
            htmlPath: g.htmlPath,
            classification: g.classification,
            localeId: g.localeId || null,
            seo: {
                title: g.title,
                description: g.description,
                canonical: g.canonical,
                robots: g.robots,
                alternates: g.alternates || [],
            },
        })),
        skipped,
        seoArtifacts: {
            sitemap: 'sitemap.xml',
            robots: 'robots.txt',
        },
    };
    const digest = sha256Hex(canonicalJson(manifest));
    manifest.manifestDigest = digest;
    fs.writeFileSync(path.join(vmzDir, 'static-delivery-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const assets = emitContentAddressedAssets(distDir);
    manifest.contentAddressedAssets = {
        schema: assets.manifest.schema,
        manifestDigest: assets.manifest.manifestDigest,
        objectCount: assets.manifest.objectCount,
        layout: assets.manifest.layout,
    };
    // Re-stamp static manifest after linking asset digest (HTML already rewritten on disk).
    delete manifest.manifestDigest;
    manifest.manifestDigest = sha256Hex(canonicalJson(manifest));
    fs.writeFileSync(path.join(vmzDir, 'static-delivery-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const cdn = emitCdnPolicy(distDir, manifest);

    return {
        manifest,
        htmlFiles: generations.map((g) => g.htmlPath),
        skipped,
        digest: manifest.manifestDigest,
        assets: assets.manifest,
        cdnPolicy: cdn.policy,
        cdnAdapters: cdn.adapters,
    };
}

/**
 * @param {string} data
 */
function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {unknown} value
 */
function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
        return out;
    }
    return value;
}

/**
 * @param {string} distDir
 */
function listPageClientFiles(distDir) {
    const root = path.join(distDir, 'pages');
    /** @type {Array<{ chunkId: string, segs: ReturnType<typeof parseChunkSegments> }>} */
    const out = [];
    function walk(abs, relParts) {
        let ents;
        try {
            ents = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            if (e.isDirectory()) walk(path.join(abs, e.name), [...relParts, e.name]);
            else if (e.isFile() && e.name.endsWith('.client.js')) {
                const stem = e.name.replace(/\.client\.js$/, '');
                if (stem === 'Layout' || stem === 'Loading' || stem === 'Error' || stem === 'NotFound') continue;
                const chunkId = ['pages', ...relParts, stem].join('/');
                out.push({ chunkId, segs: parseChunkSegments(chunkId) });
            }
        }
    }
    walk(root, []);
    return out;
}

/**
 * @param {string} chunkId
 */
function parseChunkSegments(chunkId) {
    const rel = chunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    /** @type {Array<{ kind: 'static' | 'param' | 'catch', value?: string, name?: string }>} */
    const segs = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('(') && p.endsWith(')') && p.length > 2) continue;
        if (p === 'index' && i === parts.length - 1) continue;
        const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
        const param = /^\[([^\]]+)\]$/.exec(p);
        if (catchAll) segs.push({ kind: 'catch', name: catchAll[1] });
        else if (param) segs.push({ kind: 'param', name: param[1] });
        else segs.push({ kind: 'static', value: p.toLowerCase() });
    }
    return segs;
}

/**
 * @param {ReturnType<typeof parseChunkSegments>} segs
 */
function patternFromSegs(segs) {
    if (!segs.length) return '/';
    return `/${segs
        .map((s) => {
            if (s.kind === 'static') return s.value;
            if (s.kind === 'param') return `[${s.name}]`;
            return `[...${s.name}]`;
        })
        .join('/')}`;
}

/**
 * @param {string} pathname
 */
function htmlPathForRoute(pathname) {
    const p = pathname === '/' ? '' : pathname.replace(/^\//, '').replace(/\/+$/, '');
    if (!p) return 'index.html';
    return path.join(...p.split('/'), 'index.html');
}

/**
 * @param {string} distDir
 * @param {string} chunkId
 */
async function loadCtor(distDir, chunkId) {
    const href = pathToFileURL(path.join(distDir, `${chunkId}.client.js`)).href;
    const mod = await import(`${href}?t=${Date.now()}`);
    return mod.default;
}

/**
 * @param {string} distDir
 * @param {string} pageChunkId
 */
function resolveLayoutChain(distDir, pageChunkId) {
    const rel = pageChunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    parts.pop();
    /** @type {string[]} */
    const chain = [];
    for (let i = parts.length; i >= 0; i--) {
        const dirParts = parts.slice(0, i);
        const layoutChunk = ['pages', ...dirParts, 'Layout'].join('/');
        if (fs.existsSync(path.join(distDir, `${layoutChunk}.client.js`))) chain.unshift(layoutChunk);
    }
    return chain;
}

/**
 * @param {string} distDir
 * @param {string} chunkId
 */
function guessRouteId(distDir, chunkId) {
    try {
        const js = fs.readFileSync(path.join(distDir, `${chunkId}.client.js`), 'utf8');
        const m = /export default class (\w+)/.exec(js);
        if (m) return m[1];
    } catch {
        /* ignore */
    }
    return chunkId.split('/').pop() || chunkId;
}

/**
 * @param {any} Page
 * @param {{ params: Record<string, string>, props: Record<string, unknown>, pathname: string, origin: string }} ctx
 */
async function resolvePageMeta(Page, ctx) {
    let raw = {};
    if (typeof Page.meta === 'function') {
        raw = (await Page.meta(ctx)) || {};
    } else if (Page.meta && typeof Page.meta === 'object') {
        raw = Page.meta;
    }
    const title = String(raw.title || `${guessTitle(ctx.pathname)} · VMZ`);
    const description = String(raw.description || `VMZ page ${ctx.pathname}`);
    const canonical = String(raw.canonical || `${ctx.origin}${ctx.pathname === '/' ? '/' : ctx.pathname}`);
    const robots = String(raw.robots || 'index,follow');
    const lang = String(raw.lang || 'en');
    return { title, description, canonical, robots, lang, alternates: [] };
}

/**
 * @param {string} distDir
 */
function loadLocaleArtifact(distDir) {
    const p = path.join(distDir, '_vmz', 'locale-route-realization.json');
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Expand one Static route across LocaleId realizations (hreflang seed + prefixed HTML).
 * @param {{
 *   localeArt: any,
 *   routeId: string,
 *   chunkId: string,
 *   pattern: string,
 *   origin: string,
 *   baseMeta: { title: string, description: string, canonical: string, robots: string, lang: string, alternates?: any[] },
 * }} input
 */
function expandLocaleStaticGenerations(input) {
    const { localeArt, routeId, pattern, origin, baseMeta } = input;
    if (!localeArt?.realizations?.length) {
        return [
            {
                path: pattern,
                htmlPath: htmlPathForRoute(pattern),
                localeId: null,
                meta: baseMeta,
            },
        ];
    }

    const locales = (localeArt.locales || []).map((l) => l.id);
    const directions = Object.fromEntries((localeArt.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const defaultLocale = localeArt.defaultLocale || locales[0];
    const forRoute = (localeArt.realizations || []).filter(
        (r) => r.routeId === routeId || r.routeId === input.chunkId || r.pathPattern === pattern || (r.path === pattern && !r.prefixed),
    );
    /** @type {any[]} */
    const out = [];

    for (const loc of locales) {
        const hit = forRoute.find((r) => r.localeId === loc);
        if (!hit) continue;
        const built = buildLocalePageMeta({
            routeId,
            localeId: loc,
            direction: directions[loc],
            title: baseMeta.title,
            description: baseMeta.description,
            origin,
            realizations: localeArt.realizations,
            locales,
            defaultLocale,
        });
        out.push({
            path: hit.path,
            htmlPath: htmlPathForRoute(hit.path),
            localeId: loc,
            meta: {
                title: baseMeta.title,
                description: baseMeta.description,
                canonical: built.canonical || absoluteUrl(origin, hit.path),
                robots: baseMeta.robots,
                lang: loc,
                dir: directions[loc] || 'ltr',
                alternates: built.alternates || [],
            },
        });
    }
    return out.length
        ? out
        : [
              {
                  path: pattern,
                  htmlPath: htmlPathForRoute(pattern),
                  localeId: null,
                  meta: baseMeta,
              },
          ];
}

function guessTitle(pathname) {
    if (pathname === '/') return 'Home';
    return pathname
        .split('/')
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' / ');
}

/**
 * @param {string} distDir
 */
function readCssEntry(distDir) {
    try {
        const dep = JSON.parse(fs.readFileSync(path.join(distDir, 'vmz-deployment.json'), 'utf8'));
        return dep.cssEntry || null;
    } catch {
        return null;
    }
}

/**
 * @param {{
 *   bodyHtml: string,
 *   chunkId: string,
 *   layoutChain: string[],
 *   props: Record<string, unknown>,
 *   meta: { title: string, description: string, canonical: string, robots: string, lang: string, dir?: string, alternates?: Array<{ hreflang: string, href: string }> },
 *   cssEntry: string | null,
 *   isErrorDocument?: boolean,
 * }} input
 */
function wrapDocument(input) {
    const propsJson = JSON.stringify(input.props ?? {});
    const localeId = input.meta.lang || 'en';
    const dir = input.meta.dir || 'ltr';
    const native = requireNativeAddon();
    if (typeof native.generatePageShell !== 'function') {
        throw new Error('vmz native addon missing generatePageShell — rebuild with `pnpm napi:build`');
    }
    return native.generatePageShell({
        bodyHtml: input.bodyHtml,
        chunkId: input.chunkId || '',
        layoutChain: input.layoutChain || [],
        propsJson,
        meta: {
            title: input.meta.title,
            description: input.meta.description,
            canonical: input.meta.canonical,
            robots: input.meta.robots,
            lang: localeId,
            dir,
            alternates: input.meta.alternates || [],
        },
        cssEntry: input.cssEntry || null,
        isErrorDocument: !!input.isErrorDocument,
    });
}

/**
 * @param {string} origin
 * @param {Array<{ canonical: string, robots: string }>} generations
 */
function buildSitemap(_origin, generations) {
    const urls = generations.filter((g) => !String(g.robots).includes('noindex')).map((g) => ({ loc: g.canonical }));
    const native = requireNativeAddon();
    if (typeof native.generateSitemapXml !== 'function') {
        throw new Error('vmz native addon missing generateSitemapXml — rebuild with `pnpm napi:build`');
    }
    return native.generateSitemapXml(urls);
}

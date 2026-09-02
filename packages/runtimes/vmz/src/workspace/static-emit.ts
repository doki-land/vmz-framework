/**
 * A3-static: emit per-route HTML + 404 + SEO head + StaticDeliveryManifest.
 * Reuses the same Direct SSR path as serve-host (no second SSG runtime).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listClientComponentsSync } from '@vmz/core/component-registry';
import { createRenderHost } from '@vmz/core/render-host';
import { resolveRouteLayoutChain } from '@vmz/core/route-layout-chain';
import { emitCdnPolicy } from './cdn-policy.js';
import { emitContentAddressedAssets, hashedAssetHref } from './content-addressed-assets.js';
import { LOCALE_LINK_PLAN_REL } from '../locale/locale-route-emit.js';
import {
    absoluteUrl,
    applyLocaleLinkPlan,
    buildLocaleLinkPlan,
    buildLocalePageMeta,
    linkRouteAliasesFromUnits,
} from '../locale/locale-router.js';
import { requireNativeAddon } from './native-addon.js';
import { writePrettyJsonFile } from './pretty-json.js';
import { emitPublicStaticAssets } from './public-static-assets.js';
import { emitRouteCatalog, loadRouteCatalog, ROUTE_CATALOG_SCHEMA } from './route-catalog-emit.js';
import { emitSiteFavicon, readSiteFaviconHeadHtml } from './site-favicon.js';

export const STATIC_DELIVERY_MANIFEST_SCHEMA = 'vmz.static.delivery_manifest.v0';
export const STATIC_EMIT_PLAN_SCHEMA = 'vmz.static.emit_plan.v0';

export type EmitWebStaticOpts = {
    origin?: string;
    applicationId?: string;
    staticParams?: Record<string, Array<Record<string, string>>>;
    projectRoot?: string;
};

type PageMeta = {
    title?: string;
    description?: string;
    canonical?: string;
    robots?: string;
    lang?: string;
};

type RouteGeneration = {
    routeId: string;
    path: string;
    chunkId: string;
    htmlPath: string;
    classification: string;
    title: string;
    description: string;
    canonical: string;
    robots: string;
    localeId?: string | null;
    alternates?: unknown[];
};

type StaticDeliveryManifest = {
    schema: string;
    applicationId: unknown;
    deliveryProfile: string;
    origin: string;
    generatedAt: string;
    spaFallback: boolean;
    errorDocuments: Array<{ status: number; path: string }>;
    routes: unknown[];
    skipped: unknown[];
    seoArtifacts: { sitemap: string; robots: string };
    publicAssets: {
        schema: unknown;
        status: unknown;
        fileCount: number;
        source: string | null;
    };
    manifestDigest?: string;
    contentAddressedAssets?: Record<string, unknown>;
    cdnPolicy?: unknown;
};

export async function emitWebStatic(distDir: string, opts: EmitWebStaticOpts = {}) {
    const origin = String(opts.origin || process.env.VMZ_SITE_ORIGIN || 'https://example.test').replace(/\/$/, '');
    const applicationId = opts.applicationId || path.basename(path.dirname(distDir));

    const domPath = path.join(distDir, 'vmz-dom.js');
    if (!fs.existsSync(domPath)) {
        throw new Error(`emitWebStatic: missing ${domPath} — run vmz build first`);
    }
    emitSiteFavicon(distDir, { projectRoot: opts.projectRoot });
    const faviconHead = readSiteFaviconHeadHtml(distDir);
    const publicAssets = emitPublicStaticAssets(distDir, { projectRoot: opts.projectRoot });
    const host = await createRenderHost(distDir, { strictDeployment: true, preload: 'none' });
    const { renderToString, renderToStream } = host;

    const pageCatalog = listPageClientFiles(distDir);
    const generations: RouteGeneration[] = [];
    const skipped: Array<{
        routeId: string;
        path: string;
        chunkId: string;
        classification: string;
        reason: string;
    }> = [];

    // Hash immutable assets before any HTML write so shell slots carry final URLs
    // (no post-emit HTML split/join rewrite).
    emitStaticClientEntries(distDir, pageCatalog);
    const assets = emitContentAddressedAssets(distDir);
    const cssLogical = readCssEntry(distDir);
    const cssEntry = hashedAssetHref(assets.rewrites, cssLogical) || hashedAssetHref(assets.rewrites, 'vmz.css');
    const moduleScriptSrc = hashedAssetHref(assets.rewrites, 'entry-client.js') || '/entry-client.js';
    const localeArt = loadLocaleArtifact(distDir);
    const localeLinkPlan = loadLocaleLinkPlan(distDir) || buildLocaleLinkPlan(withLinkRouteAliases(localeArt, distDir, pageCatalog));

    for (const page of pageCatalog) {
        const pattern = page.pathPattern || patternFromSegs(page.segs);
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
        const layoutChain = resolveRouteLayoutChain(distDir, page.chunkId);
        await host.ensureComponents([page.chunkId, ...layoutChain]);
        let bodyHtml = '';
        for await (const chunk of renderToStream(Page, props, {})) {
            bodyHtml += chunk;
        }
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const Layout = await loadCtor(distDir, layoutChain[i]);
            if (!Layout) continue;
            bodyHtml = await renderToString(Layout, {}, { slotHtml: bodyHtml });
        }

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
            const localizedBody =
                gen.localeId && localeLinkPlan.rows.length ? applyLocaleLinkPlan(bodyHtml, gen.localeId, localeLinkPlan) : bodyHtml;
            const html = wrapDocument({
                bodyHtml: localizedBody,
                chunkId: page.chunkId,
                layoutChain,
                props,
                meta: gen.meta,
                cssEntry,
                moduleScriptSrc,
                headExtraHtml: faviconHead,
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
        cssEntry,
        moduleScriptSrc: '',
        isErrorDocument: true,
        headExtraHtml: faviconHead,
    });
    fs.writeFileSync(path.join(distDir, '404.html'), notFoundHtml, 'utf8');

    const sitemap = buildSitemap(origin, generations);
    fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap, 'utf8');
    const nativeRobots = requireNativeAddon();
    if (typeof nativeRobots.generateRobotsTxt !== 'function') {
        throw new Error('vmz native addon missing generateRobotsTxt — rebuild with `pnpm napi:build`');
    }
    const robots = nativeRobots.generateRobotsTxt(`${origin}/sitemap.xml`);
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
    const manifest: StaticDeliveryManifest = {
        schema: STATIC_DELIVERY_MANIFEST_SCHEMA,
        applicationId,
        deliveryProfile: 'static',
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
        publicAssets: {
            schema: publicAssets.schema,
            status: publicAssets.status,
            fileCount: publicAssets.fileCount ?? 0,
            source: 'source' in publicAssets && typeof publicAssets.source === 'string' ? publicAssets.source : null,
        },
        contentAddressedAssets: {
            schema: assets.manifest.schema,
            manifestDigest: assets.manifest.manifestDigest,
            objectCount: assets.manifest.objectCount,
            layout: assets.manifest.layout,
        },
    };
    const digest = sha256Hex(canonicalJson(manifest));
    manifest.manifestDigest = digest;
    writePrettyJsonFile(path.join(vmzDir, 'static-delivery-manifest.json'), manifest);

    writePrettyJsonFile(path.join(vmzDir, 'static-emit-plan.json'), {
        schema: STATIC_EMIT_PLAN_SCHEMA,
        applicationId,
        deliveryProfile: 'static',
        origin,
        localeLinks: localeLinkPlan,
        assetPlanPath: '_vmz/asset-plan.json',
        routes: generations.map((g) => ({
            routeId: g.routeId,
            path: g.path,
            chunkId: g.chunkId,
            htmlPath: g.htmlPath,
            classification: g.classification,
            localeId: g.localeId || null,
        })),
    });

    const cdn = emitCdnPolicy(distDir, manifest);

    return {
        manifest,
        htmlFiles: generations.map((g) => g.htmlPath),
        skipped,
        digest: manifest.manifestDigest,
        assets: assets.manifest,
        publicAssets,
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
    let catalog = loadRouteCatalog(distDir);
    if (!catalog?.pages?.length) {
        const emitted = emitRouteCatalog(distDir);
        if (!emitted.ok || !emitted.catalog?.pages?.length) {
            throw new Error(`emitWebStatic: missing compiled ${ROUTE_CATALOG_SCHEMA} at _vmz/route-catalog.json (${emitted.error || 'empty'})`);
        }
        catalog = emitted.catalog;
    }
    return catalog.pages.map((p) => ({
        chunkId: p.chunkId,
        pathPattern: p.pathPattern,
        pageRel: p.pageRel,
        segs: p.segs,
        routeId: p.routeId,
    }));
}

/**
 * @param {ReturnType<typeof parsePathPattern>} segs
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

async function resolvePageMeta(
    Page: {
        meta?:
            | PageMeta
            | ((ctx: {
                  params: Record<string, string>;
                  props: Record<string, unknown>;
                  pathname: string;
                  origin: string;
              }) => PageMeta | Promise<PageMeta>);
    },
    ctx: { params: Record<string, string>; props: Record<string, unknown>; pathname: string; origin: string },
) {
    let raw: PageMeta = {};
    if (typeof Page.meta === 'function') {
        raw = (await Page.meta(ctx)) || {};
    } else if (Page.meta && typeof Page.meta === 'object') {
        raw = Page.meta;
    }
    const title = String(raw.title || guessTitle(ctx.pathname) || 'App');
    const description = String(raw.description || '');
    const canonical = String(raw.canonical || `${ctx.origin}${ctx.pathname === '/' ? '/' : ctx.pathname}`);
    const robots = String(raw.robots || 'index,follow');
    const lang = String(raw.lang || 'en');
    return { title, description, canonical, robots, lang, alternates: [] as unknown[] };
}

function loadLocaleArtifact(distDir: string): Record<string, unknown> | null {
    const p = path.join(distDir, '_vmz', 'locale-route-realization.json');
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function loadLocaleLinkPlan(distDir: string): ReturnType<typeof buildLocaleLinkPlan> | null {
    const p = path.join(distDir, ...LOCALE_LINK_PLAN_REL.split('/'));
    if (!fs.existsSync(p)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { schema?: string; rows?: unknown };
        if (raw?.schema !== 'vmz.static.locale_link_plan.v0' || !Array.isArray(raw.rows)) return null;
        return raw as ReturnType<typeof buildLocaleLinkPlan>;
    } catch {
        return null;
    }
}

type LocaleArtWithAliases = Record<string, unknown> & {
    linkRouteAliases?: Array<{ linkRouteId: string; realizationRouteId: string }>;
};

/** Bridge Link class RouteId ↔ realization chunk routeId for locale href rewrite. */
function withLinkRouteAliases(
    localeArt: Record<string, unknown> | null,
    distDir: string,
    pageCatalog: Array<{ chunkId: string }>,
): LocaleArtWithAliases | null {
    if (!localeArt) return null;
    try {
        const dep = JSON.parse(fs.readFileSync(path.join(distDir, 'vmz-deployment.json'), 'utf8')) as {
            units?: Array<{ kind?: string; routeId?: string; chunkId?: string }>;
        };
        const fromDep = linkRouteAliasesFromUnits(Array.isArray(dep.units) ? dep.units : []);
        if (fromDep.length) return { ...localeArt, linkRouteAliases: fromDep };
    } catch {
        /* fall through to catalog guess */
    }
    const guessed: Array<{ linkRouteId: string; realizationRouteId: string }> = [];
    for (const page of pageCatalog || []) {
        const linkRouteId = guessRouteId(distDir, page.chunkId);
        if (linkRouteId && linkRouteId !== page.chunkId) {
            guessed.push({ linkRouteId, realizationRouteId: page.chunkId });
        }
    }
    return guessed.length ? { ...localeArt, linkRouteAliases: guessed } : localeArt;
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
 *   moduleScriptSrc?: string,
 *   isErrorDocument?: boolean,
 *   headExtraHtml?: string,
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
        // napi Option<String>: omit/undefined = None; null is rejected as String
        ...(input.cssEntry ? { cssEntry: String(input.cssEntry) } : {}),
        isErrorDocument: !!input.isErrorDocument,
        ...(input.headExtraHtml ? { headExtraHtml: String(input.headExtraHtml) } : {}),
        ...(input.moduleScriptSrc !== undefined ? { moduleScriptSrc: String(input.moduleScriptSrc) } : {}),
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

/**
 * Static CDN must ship entry-client/event like serve-host (content-addressed + HTML rewrite).
 * @param {string} distDir
 * @param {Array<{ chunkId: string }>} pageCatalog
 */
function emitStaticClientEntries(distDir, pageCatalog) {
    const componentEntries = listClientComponentsSync(distDir, { strict: true });
    const indexChunk = pageCatalog.find((p) => p.chunkId === 'pages/index')?.chunkId || pageCatalog[0]?.chunkId || 'pages/index';
    const resumeEntries = loadPageResumeEntriesSync(distDir, indexChunk);
    const lazySet = new Set(
        resumeEntries
            .filter((e) => isEventResumeStrategy(e.strategy))
            .map((e) => e.component)
            .filter(Boolean),
    );
    const eager = componentEntries.filter((e) => !lazySet.has(e.name));
    const lazy = componentEntries.filter((e) => lazySet.has(e.name));
    const native = requireNativeAddon();
    if (typeof native.generateServeEntryClient !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryClient — rebuild with `pnpm napi:build`');
    }
    fs.writeFileSync(path.join(distDir, 'entry-client.js'), native.generateServeEntryClient(eager, lazy, ''), 'utf8');
    if (typeof native.generateServeEntryEvent === 'function') {
        fs.writeFileSync(path.join(distDir, 'entry-event.js'), native.generateServeEntryEvent(''), 'utf8');
    }
}

/**
 * @param {string} distDir
 * @param {string} chunkId
 */
function loadPageResumeEntriesSync(distDir, chunkId) {
    try {
        const dep = JSON.parse(fs.readFileSync(path.join(distDir, 'vmz-deployment.json'), 'utf8'));
        const units = Array.isArray(dep.units) ? dep.units : [];
        const page =
            units.find((u) => u.chunkId === chunkId) || units.find((u) => u.chunkId === 'pages/index') || units.find((u) => u.kind === 'page');
        const entries = Array.isArray(page?.resumeEntries) ? page.resumeEntries : [];
        return entries.map((e) => ({
            component: String(e.component || ''),
            strategy: String(e.strategy || ''),
        }));
    } catch {
        return [];
    }
}

/** @param {string} strategy */
function isEventResumeStrategy(strategy) {
    return strategy === 'event' || strategy === 'click' || String(strategy).startsWith('event:');
}

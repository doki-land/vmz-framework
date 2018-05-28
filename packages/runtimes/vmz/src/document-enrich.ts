// @ts-nocheck
/**
 * Document D1 — enrich manifest with routes, anchors, nav; diagnose links.
 * Design: 规划设计/vmz/19 §5–6
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIAG } from './document-schema.js';
/**
 * @param {string} routeBase e.g. /docs
 * @param {string} locale
 * @param {string} pageKey
 */
export function pageRoute(routeBase, locale, pageKey) {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const parts = [base.replace(/^\//, ''), locale, key].filter((p) => p !== '');
    return '/' + parts.join('/');
}
/**
 * Static file path relative to out dir (posix).
 * @param {string} routeBase
 * @param {string} locale
 * @param {string} pageKey
 */
export function pageHtmlRel(routeBase, locale, pageKey) {
    const base = String(routeBase || '/')
        .replace(/^\//, '')
        .replace(/\/$/, '');
    const file = pageKey === 'index' ? 'index.html' : `${pageKey.replace(/\\/g, '/')}.html`;
    return [base, locale, file].filter(Boolean).join('/');
}
/**
 * @param {import('./document-schema.js').DocumentManifest} manifest
 * @param {{ analyzeMarkdown: Function, projectRoot: string, designsCssHref?: string | null }} ctx
 */
export function enrichDocumentContent(manifest, ctx) {
    const routeBase = manifest.mounts?.[0]?.routeBase || '/docs';
    /** @type {Map<string, { html: string, headings: any[], links: any[], title: string, route: string, anchors: string[] }>} */
    const byId = new Map();
    /** @type {import('./document-schema.js').DocumentDiagnostic[]} */
    const diagnostics = [...(manifest.diagnostics || [])];
    /** @type {Map<string, string>} */
    const routeOwners = new Map();
    for (const page of manifest.pages) {
        const abs = path.isAbsolute(page.sourcePath) ? page.sourcePath : path.join(manifest.root, page.sourcePath);
        const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const analyzed = ctx.analyzeMarkdown(source);
        const route = pageRoute(routeBase, page.identity.locale, page.identity.pageKey);
        const anchors = analyzed.headings.map((h) => h.id);
        const title = analyzed.headings.find((h) => h.level === 1)?.text || analyzed.headings[0]?.text || page.identity.pageKey;
        // Duplicate anchors on page
        const seen = new Set();
        for (const id of anchors) {
            if (seen.has(id)) {
                diagnostics.push({
                    code: DIAG.ANCHOR_DUPLICATE,
                    severity: 'error',
                    message: `duplicate anchor #${id} on ${page.identity.locale}/${page.identity.pageKey}`,
                    path: page.sourcePath,
                });
            }
            seen.add(id);
        }
        if (routeOwners.has(route)) {
            diagnostics.push({
                code: DIAG.ROUTE_DUPLICATE,
                severity: 'error',
                message: `duplicate route ${route} (also ${routeOwners.get(route)})`,
                path: page.sourcePath,
            });
        } else {
            routeOwners.set(route, `${page.identity.locale}:${page.identity.pageKey}`);
        }
        page.route = route;
        page.anchors = anchors;
        page.title = title;
        byId.set(`${page.identity.locale}:${page.identity.pageKey}`, {
            html: analyzed.html,
            headings: analyzed.headings,
            links: analyzed.links,
            title,
            route,
            anchors,
        });
    }
    // Nav per locale (directory order: pageKey sorted)
    /** @type {Record<string, Array<{ pageKey: string, title: string, href: string }>>} */
    const navByLocale = {};
    for (const loc of manifest.locales) {
        const pages = manifest.pages
            .filter((p) => p.identity.locale === loc)
            .slice()
            .sort((a, b) => a.identity.pageKey.localeCompare(b.identity.pageKey));
        navByLocale[loc] = pages.map((p) => ({
            pageKey: p.identity.pageKey,
            title: p.title || p.identity.pageKey,
            href: p.route,
        }));
    }
    // Link checks
    const pageKeySet = new Map(); // locale -> Set pageKey
    for (const p of manifest.pages) {
        const set = pageKeySet.get(p.identity.locale) || new Set();
        set.add(p.identity.pageKey);
        pageKeySet.set(p.identity.locale, set);
    }
    for (const page of manifest.pages) {
        const info = byId.get(`${page.identity.locale}:${page.identity.pageKey}`);
        if (!info) continue;
        for (const link of info.links) {
            const href = String(link.href || '').trim();
            if (!href || href.startsWith('mailto:') || href.startsWith('http://') || href.startsWith('https://')) {
                continue;
            }
            // D2 API refs are resolved by evidence, not as page links.
            if (href.startsWith('vmz-api:') || href.startsWith('api:')) {
                continue;
            }
            if (href.startsWith('#')) {
                const id = href.slice(1);
                if (!info.anchors.includes(id)) {
                    diagnostics.push({
                        code: DIAG.LINK_BROKEN,
                        severity: 'error',
                        message: `broken anchor ${href} on ${page.identity.locale}/${page.identity.pageKey}`,
                        path: page.sourcePath,
                    });
                }
                continue;
            }
            const resolved = resolveDocHref(href, page.identity.pageKey, page.identity.locale, routeBase, pageKeySet);
            if (!resolved.ok) {
                diagnostics.push({
                    code: DIAG.LINK_BROKEN,
                    severity: 'error',
                    message: `broken link ${JSON.stringify(href)}: ${resolved.reason}`,
                    path: page.sourcePath,
                });
            } else if (resolved.anchor) {
                const target = byId.get(`${resolved.locale}:${resolved.pageKey}`);
                const anchors = target?.anchors || [];
                if (!anchors.includes(resolved.anchor)) {
                    diagnostics.push({
                        code: DIAG.LINK_BROKEN,
                        severity: 'error',
                        message: `broken link ${JSON.stringify(href)}: missing anchor #${resolved.anchor}`,
                        path: page.sourcePath,
                    });
                }
            }
        }
    }
    return { byId, navByLocale, diagnostics, routeBase };
}
/**
 * @param {string} href
 * @param {string} fromPageKey
 * @param {string} locale
 * @param {string} routeBase
 * @param {Map<string, Set<string>>} pageKeySet
 */
function resolveDocHref(href, fromPageKey, locale, routeBase, pageKeySet) {
    let pathPart = href;
    let anchor = null;
    const hash = href.indexOf('#');
    if (hash >= 0) {
        pathPart = href.slice(0, hash);
        anchor = href.slice(hash + 1);
    }
    pathPart = pathPart.replace(/\.md$/i, '').replace(/\\/g, '/');
    if (pathPart.startsWith('/')) {
        // Absolute site path under mount: /docs/zh-hans/guide/install
        const want = pathPart.replace(/\/$/, '') || '/';
        const prefix = pageRoute(routeBase, locale, 'index').replace(/\/$/, '');
        // Accept full route or locale-relative
        for (const [loc, keys] of pageKeySet) {
            for (const pk of keys) {
                const r = pageRoute(routeBase, loc, pk).replace(/\/$/, '');
                if (r === want || want.endsWith(`/${loc}/${pk === 'index' ? '' : pk}`.replace(/\/$/, ''))) {
                    return { ok: true, locale: loc, pageKey: pk, anchor, anchors: [] };
                }
            }
        }
        // Still ok if matches any known route shape for this locale
        const keys = pageKeySet.get(locale) || new Set();
        const stripped = want.replace(new RegExp(`^${escapeRe(routeBase.replace(/\/$/, ''))}/${escapeRe(locale)}/?`), '');
        const pk = stripped === '' ? 'index' : stripped;
        if (keys.has(pk)) return { ok: true, locale, pageKey: pk, anchor, anchors: [] };
        return { ok: false, reason: 'unknown route' };
    }
    // Relative to current page directory
    const fromDir = pageKeyDir(fromPageKey);
    const joined = path.posix.normalize(path.posix.join(fromDir || '.', pathPart));
    let pk = joined === '.' || joined === '' ? 'index' : joined.replace(/^\.\//, '');
    pk = normalizePageKey(pk);
    const keys = pageKeySet.get(locale) || new Set();
    if (!keys.has(pk)) {
        return { ok: false, reason: `no PageKey ${pk} in ${locale}` };
    }
    return { ok: true, locale, pageKey: pk, anchor, anchors: [] };
}
/**
 * Directory used for relative Markdown links.
 * `index` → repo root; bare `guide` (from guide/index.md) → `guide`;
 * `guide/install` → `guide`.
 */
function pageKeyDir(pageKey) {
    if (!pageKey || pageKey === 'index') return '';
    if (!pageKey.includes('/')) return pageKey;
    return pageKey.slice(0, pageKey.lastIndexOf('/'));
}
/** Strip trailing `/index` so guide/index.md links resolve to PageKey `guide`. */
function normalizePageKey(pageKey) {
    let pk = String(pageKey || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    if (pk.endsWith('/index')) {
        pk = pk.slice(0, -'/index'.length);
    } else if (pk === 'index') {
        return 'index';
    }
    return pk === '' || pk === '.' ? 'index' : pk;
}
function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

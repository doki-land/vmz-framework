/**
 * Document — enrich manifest with routes, anchors, nav; diagnose links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIAG, type DocumentDiagnostic, type DocumentManifest } from './document-schema.js';

export interface DocumentRoutingStrategy {
    strategy?: string;
}

export interface DocumentHeading {
    id: string;
    level: number;
    text: string;
}

export interface DocumentLink {
    href?: string;
}

export interface AnalyzedMarkdown {
    html: string;
    headings: DocumentHeading[];
    links?: DocumentLink[];
    fences?: Array<{
        info?: string;
        content?: string;
        lineStart?: number;
        lineEnd?: number;
    }>;
}

export interface EnrichedPageInfo {
    html: string;
    headings: DocumentHeading[];
    links: DocumentLink[];
    title: string;
    route: string;
    anchors: string[];
}

export interface DocumentNavItem {
    pageKey: string;
    title: string;
    href: string;
}

export interface EnrichDocumentContentCtx {
    analyzeMarkdown: (source: string) => AnalyzedMarkdown;
    projectRoot: string;
    designsCssHref?: string | null;
    routing?: DocumentRoutingStrategy;
}

export interface EnrichDocumentContentResult {
    byId: Map<string, EnrichedPageInfo>;
    navByLocale: Record<string, DocumentNavItem[]>;
    diagnostics: DocumentDiagnostic[];
    routeBase: string;
}

export function pageRoute(routeBase: string, locale: string, pageKey: string, routing: DocumentRoutingStrategy = {}): string {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const strategy = routing.strategy || 'prefix';
    if (strategy === 'none' || strategy === 'domain') {
        const parts = [base.replace(/^\//, ''), key].filter((p) => p !== '');
        return '/' + (parts.length ? parts.join('/') : '');
    }
    const parts = [base.replace(/^\//, ''), locale, key].filter((p) => p !== '');
    return '/' + parts.join('/');
}

/** Static file path relative to out dir (posix). */
export function pageHtmlRel(routeBase: string, locale: string, pageKey: string): string {
    const base = String(routeBase || '/')
        .replace(/^\//, '')
        .replace(/\/$/, '');
    const file = pageKey === 'index' ? 'index.html' : `${pageKey.replace(/\\/g, '/')}.html`;
    return [base, locale, file].filter(Boolean).join('/');
}

export function enrichDocumentContent(manifest: DocumentManifest, ctx: EnrichDocumentContentCtx): EnrichDocumentContentResult {
    const routeBase = manifest.mounts?.[0]?.routeBase || '/docs';
    const routing = ctx.routing || { strategy: 'prefix' };
    const byId = new Map<string, EnrichedPageInfo>();
    const diagnostics: DocumentDiagnostic[] = [...(manifest.diagnostics || [])];
    const routeOwners = new Map<string, string>();
    for (const page of manifest.pages) {
        const abs = path.isAbsolute(page.sourcePath) ? page.sourcePath : path.join(manifest.root, page.sourcePath);
        const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const analyzed = ctx.analyzeMarkdown(source);
        const route = pageRoute(routeBase, page.identity.locale, page.identity.pageKey, routing);
        const anchors = analyzed.headings.map((h) => h.id);
        const title = analyzed.headings.find((h) => h.level === 1)?.text || analyzed.headings[0]?.text || page.identity.pageKey;
        // Duplicate anchors on page
        const seen = new Set<string>();
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
        const owner = `${page.identity.locale}:${page.identity.pageKey}`;
        if (routing.strategy === 'none' || routing.strategy === 'domain') {
            routeOwners.set(route, owner);
        } else if (routeOwners.has(route)) {
            diagnostics.push({
                code: DIAG.ROUTE_DUPLICATE,
                severity: 'error',
                message: `duplicate route ${route} (also ${routeOwners.get(route)})`,
                path: page.sourcePath,
            });
        } else {
            routeOwners.set(route, owner);
        }
        page.route = route;
        page.anchors = anchors;
        page.title = title;
        byId.set(`${page.identity.locale}:${page.identity.pageKey}`, {
            html: analyzed.html,
            headings: analyzed.headings,
            links: analyzed.links || [],
            title,
            route,
            anchors,
        });
    }
    // Nav per locale (directory order: pageKey sorted)
    const navByLocale: Record<string, DocumentNavItem[]> = {};
    for (const loc of manifest.locales) {
        const pages = manifest.pages
            .filter((p) => p.identity.locale === loc)
            .slice()
            .sort((a, b) => a.identity.pageKey.localeCompare(b.identity.pageKey));
        navByLocale[loc] = pages.map((p) => ({
            pageKey: p.identity.pageKey,
            title: p.title || p.identity.pageKey,
            href: p.route || '',
        }));
    }
    // Link checks
    const pageKeySet = new Map<string, Set<string>>(); // locale -> Set pageKey
    for (const p of manifest.pages) {
        const set = pageKeySet.get(p.identity.locale) || new Set<string>();
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
            // API refs are resolved by evidence, not as page links.
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
            if (resolved.ok === false) {
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

interface ResolveDocHrefOk {
    ok: true;
    locale: string;
    pageKey: string;
    anchor: string | null;
    anchors: string[];
}

interface ResolveDocHrefErr {
    ok: false;
    reason: string;
}

function resolveDocHref(
    href: string,
    fromPageKey: string,
    locale: string,
    routeBase: string,
    pageKeySet: Map<string, Set<string>>,
): ResolveDocHrefOk | ResolveDocHrefErr {
    let pathPart = href;
    let anchor: string | null = null;
    const hash = href.indexOf('#');
    if (hash >= 0) {
        pathPart = href.slice(0, hash);
        anchor = href.slice(hash + 1);
    }
    pathPart = pathPart.replace(/\.md$/i, '').replace(/\\/g, '/');
    if (pathPart.startsWith('/')) {
        // Absolute site path under mount: /docs/zh-hans/guide/install
        const want = pathPart.replace(/\/$/, '') || '/';
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
        const keys = pageKeySet.get(locale) || new Set<string>();
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
    const keys = pageKeySet.get(locale) || new Set<string>();
    if (!keys.has(pk)) {
        // A directory index and a leaf page share the same normalized PageKey shape.
        // Prefer the regular sibling resolution above, then retry relative to the
        // PageKey itself so `guide/optimizations/index.md` keeps its directory.
        const indexJoined = path.posix.normalize(path.posix.join(fromPageKey || '.', pathPart));
        const indexPk = normalizePageKey(indexJoined.replace(/^\.\//, ''));
        if (keys.has(indexPk)) {
            return { ok: true, locale, pageKey: indexPk, anchor, anchors: [] };
        }
        return { ok: false, reason: `no PageKey ${pk} in ${locale}` };
    }
    return { ok: true, locale, pageKey: pk, anchor, anchors: [] };
}

/**
 * Directory used for relative Markdown links.
 * `index` → repo root; bare `guide` (from guide/index.md) → `guide`;
 * `guide/install` → `guide`.
 */
function pageKeyDir(pageKey: string): string {
    if (!pageKey || pageKey === 'index') return '';
    if (!pageKey.includes('/')) return pageKey;
    return pageKey.slice(0, pageKey.lastIndexOf('/'));
}

/** Strip trailing `/index` so guide/index.md links resolve to PageKey `guide`. */
function normalizePageKey(pageKey: string): string {
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

function escapeRe(s: string): string {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

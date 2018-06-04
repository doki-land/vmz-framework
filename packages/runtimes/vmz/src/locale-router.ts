// @ts-nocheck
/**
 * Locale router / PageMeta: route realization · canonical · hreflang ·
 * Link locale retain · locale-aware cache key.
 *
 * LocaleId is a RouteNode realization dimension — not part of stable RouteId.
 */

import { negotiateLocale } from './locale-runtime.js';
import {
    DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT,
    DIAG_LOCALE_CANONICAL_MISSING,
    DIAG_LOCALE_HREFLANG_INCOMPLETE,
    DIAG_LOCALE_LINK_HARDCODED_PATH,
    DIAG_LOCALE_META_LOCALE_MISMATCH,
    DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT,
    DIAG_LOCALE_ROUTE_COLLISION,
    LOCALE_LINK_RESOLUTION_SCHEMA,
    LOCALE_PAGE_META_SCHEMA,
    LOCALE_ROUTE_REALIZATION_SCHEMA,
    LOCALE_ROUTER_CHECK_SCHEMA,
} from './locale-schema.js';

/**
 * @param {string} path
 */
function normalizePath(path) {
    let p = String(path || '/');
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
}

/**
 * Join locale prefix with a stable route path pattern.
 * @param {string} localeId
 * @param {string} pathPattern stable path without locale (e.g. /account/profile)
 * @param {{ strategy?: string, defaultPrefix?: string, defaultLocale?: string }} routing
 */
export function realizeRoutePath(localeId, pathPattern, routing = {}) {
    const strategy = routing.strategy || 'prefix';
    const defaultPrefix = routing.defaultPrefix || 'include';
    const defaultLocale = routing.defaultLocale;
    const base = normalizePath(pathPattern);

    if (strategy === 'none' || strategy === 'domain') {
        return {
            schema: LOCALE_ROUTE_REALIZATION_SCHEMA,
            localeId,
            path: base,
            prefixed: false,
            strategy,
        };
    }

    // prefix
    const omitDefault = defaultPrefix === 'omit' && localeId === defaultLocale;
    if (omitDefault) {
        return {
            schema: LOCALE_ROUTE_REALIZATION_SCHEMA,
            localeId,
            path: base,
            prefixed: false,
            strategy: 'prefix',
            defaultPrefix: 'omit',
        };
    }
    const path = base === '/' ? `/${localeId}` : `/${localeId}${base}`;
    return {
        schema: LOCALE_ROUTE_REALIZATION_SCHEMA,
        localeId,
        path,
        prefixed: true,
        strategy: 'prefix',
        defaultPrefix,
    };
}

/**
 * Build RouteId × LocaleId realization table.
 * @param {{
 * routes: Array<{ routeId: string, path: string }>,
 * locales: string[],
 * defaultLocale: string,
 * routing?: { strategy?: string, defaultPrefix?: string },
 * }} input
 */
export function buildLocaleRouteRealizationTable(input) {
    const routing = {
        strategy: input.routing?.strategy || 'prefix',
        defaultPrefix: input.routing?.defaultPrefix || 'include',
        defaultLocale: input.defaultLocale,
    };
    /** @type {any[]} */
    const realizations = [];
    /** @type {Map<string, string>} */
    const pathOwners = new Map();
    /** @type {any[]} */
    const diagnostics = [];

    for (const route of input.routes || []) {
        for (const localeId of input.locales || []) {
            const r = realizeRoutePath(localeId, route.path, routing);
            const entry = {
                ...r,
                routeId: route.routeId,
                pathPattern: normalizePath(route.path),
            };
            realizations.push(entry);
            const prev = pathOwners.get(entry.path);
            if (prev && prev !== `${route.routeId}@${localeId}`) {
                diagnostics.push({
                    code: DIAG_LOCALE_ROUTE_COLLISION,
                    severity: 'error',
                    message: `path ${entry.path} claimed by ${prev} and ${route.routeId}@${localeId}`,
                });
            } else {
                pathOwners.set(entry.path, `${route.routeId}@${localeId}`);
            }
        }
    }

    return {
        schema: LOCALE_ROUTE_REALIZATION_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        routing,
        realizations,
        diagnostics,
    };
}

/**
 * Absolute URL helper.
 * @param {string} origin
 * @param {string} path
 */
export function absoluteUrl(origin, path) {
    const o = String(origin || '').replace(/\/$/, '');
    const p = normalizePath(path);
    return `${o}${p}`;
}

/**
 * Locale-aware PageMeta for one RouteId × LocaleId.
 * @param {{
 * routeId: string,
 * localeId: string,
 * direction?: string,
 * title: string,
 * description?: string,
 * origin: string,
 * realizations: Array<{ routeId: string, localeId: string, path: string }>,
 * locales: string[],
 * defaultLocale: string,
 * }} input
 */
export function buildLocalePageMeta(input) {
    const forRoute = (input.realizations || []).filter((r) => r.routeId === input.routeId);
    const self = forRoute.find((r) => r.localeId === input.localeId);
    /** @type {any[]} */
    const diagnostics = [];
    if (!self?.path) {
        diagnostics.push({
            code: DIAG_LOCALE_CANONICAL_MISSING,
            severity: 'error',
            message: `no realization for ${input.routeId}@${input.localeId}`,
        });
    }
    const canonicalPath = self?.path || '/';
    const canonical = absoluteUrl(input.origin, canonicalPath);
    /** @type {Array<{ localeId: string, hreflang: string, href: string }>} */
    const alternates = [];
    for (const loc of input.locales || []) {
        const hit = forRoute.find((r) => r.localeId === loc);
        if (!hit) {
            diagnostics.push({
                code: DIAG_LOCALE_HREFLANG_INCOMPLETE,
                severity: 'error',
                message: `missing alternate realization for ${input.routeId}@${loc}`,
            });
            continue;
        }
        alternates.push({
            localeId: loc,
            hreflang: loc,
            href: absoluteUrl(input.origin, hit.path),
        });
    }
    const defaultHit = forRoute.find((r) => r.localeId === input.defaultLocale);
    if (defaultHit) {
        alternates.push({
            localeId: input.defaultLocale,
            hreflang: 'x-default',
            href: absoluteUrl(input.origin, defaultHit.path),
        });
    }

    return {
        schema: LOCALE_PAGE_META_SCHEMA,
        routeId: input.routeId,
        locale: input.localeId,
        htmlLang: input.localeId,
        dir: input.direction || 'ltr',
        title: input.title,
        description: input.description || '',
        canonical,
        alternates,
        diagnostics,
        status: diagnostics.length ? 'failed' : 'ready',
    };
}

/**
 * `<Link to="routeId">` retains current locale — never hand-written localized paths.
 * @param {{
 * to: string,
 * currentLocale: string,
 * realizations: Array<{ routeId: string, localeId: string, path: string }>,
 * }} input
 */
export function resolveLinkHref(input) {
    const to = input.to;
    if (typeof to === 'string' && (to.startsWith('/') || /^https?:/i.test(to))) {
        const looksLocalized = /^\/[a-z]{2,3}(-[a-z0-9]+)?(\/|$)/.test(to);
        return {
            schema: LOCALE_LINK_RESOLUTION_SCHEMA,
            status: 'failed',
            to,
            href: null,
            localeId: input.currentLocale,
            diagnostics: [
                {
                    code: DIAG_LOCALE_LINK_HARDCODED_PATH,
                    severity: 'error',
                    message: looksLocalized
                        ? `Link must use RouteId, not localized path ${JSON.stringify(to)}`
                        : `Link must use RouteId, not path ${JSON.stringify(to)}`,
                },
            ],
        };
    }
    const hit = (input.realizations || []).find((r) => r.routeId === to && r.localeId === input.currentLocale);
    if (!hit) {
        return {
            schema: LOCALE_LINK_RESOLUTION_SCHEMA,
            status: 'failed',
            to,
            href: null,
            localeId: input.currentLocale,
            diagnostics: [
                {
                    code: DIAG_LOCALE_CANONICAL_MISSING,
                    severity: 'error',
                    message: `no realization for Link to=${to} locale=${input.currentLocale}`,
                },
            ],
        };
    }
    return {
        schema: LOCALE_LINK_RESOLUTION_SCHEMA,
        status: 'ready',
        to,
        routeId: to,
        localeId: input.currentLocale,
        href: hit.path,
        diagnostics: [],
    };
}

/**
 * Parse locale prefix from a pathname under prefix strategy.
 * @param {string} pathname
 * @param {string[]} supportedLocales
 */
export function parseLocaleFromPath(pathname, supportedLocales) {
    const parts = normalizePath(pathname).split('/').filter(Boolean);
    if (!parts.length) return { localeId: null, restPath: '/' };
    if (supportedLocales.includes(parts[0])) {
        const rest = parts.slice(1);
        return { localeId: parts[0], restPath: rest.length ? `/${rest.join('/')}` : '/' };
    }
    return { localeId: null, restPath: normalizePath(pathname) };
}

/**
 * Rewrite a same-app href to the given LocaleId via route realization.
 * Stable path (no locale) is recovered first, then re-realized — Link never hardcodes locale.
 * @param {string} href
 * @param {string} localeId
 * @param {{
 *   locales?: Array<{ id: string }|string>,
 *   defaultLocale?: string,
 *   routing?: { strategy?: string, defaultPrefix?: string, defaultLocale?: string },
 * }} artifact
 */
export function localizeSameAppHref(href, localeId, artifact) {
    if (!href || !localeId || !artifact) return href;
    if (href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) return href;

    let pathname = String(href);
    let search = '';
    let hash = '';
    const hashIdx = pathname.indexOf('#');
    if (hashIdx >= 0) {
        hash = pathname.slice(hashIdx);
        pathname = pathname.slice(0, hashIdx);
    }
    const qIdx = pathname.indexOf('?');
    if (qIdx >= 0) {
        search = pathname.slice(qIdx);
        pathname = pathname.slice(0, qIdx);
    }
    if (!pathname) pathname = '/';

    const supported = (artifact.locales || []).map((l) => (typeof l === 'string' ? l : l.id)).filter(Boolean);
    const defaultLocale = artifact.defaultLocale || artifact.routing?.defaultLocale;
    const routing = {
        strategy: artifact.routing?.strategy || 'prefix',
        defaultPrefix: artifact.routing?.defaultPrefix || 'include',
        defaultLocale,
    };
    const parsed = parseLocaleFromPath(pathname, supported);
    const rest = parsed.restPath || '/';
    const realized = realizeRoutePath(localeId, rest, routing);
    return `${realized.path}${search}${hash}`;
}

/**
 * Rewrite `<a data-vmz-route href>` in HTML body to retain `localeId`.
 * @param {string} html
 * @param {string} localeId
 * @param {Parameters<typeof localizeSameAppHref>[2]} artifact
 * @param {(s: string) => string} [escapeAttr]
 */
export function localizeBodyLinks(html, localeId, artifact, escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')) {
    if (!html || !localeId || !artifact) return html;
    return String(html).replace(/<a\b([^>]*)>/gi, (full, attrs) => {
        if (!/\bdata-vmz-route\s*=/.test(attrs)) return full;
        const hm = attrs.match(/\bhref\s*=\s*"([^"]*)"/i);
        if (!hm) return full;
        const next = localizeSameAppHref(hm[1], localeId, artifact);
        if (next === hm[1]) return full;
        const newAttrs = attrs.replace(/\bhref\s*=\s*"[^"]*"/i, `href="${escapeAttr(next)}"`);
        return `<a${newAttrs}>`;
    });
}

/**
 * Plan redirect / negotiation for an incoming URL (omit-prefix aware).
 * @param {{
 * pathname: string,
 * supportedLocales: string[],
 * defaultLocale: string,
 * routing?: { strategy?: string, defaultPrefix?: string },
 * hostCandidates?: string[],
 * preference?: string|null,
 * userChoice?: string|null,
 * }} input
 */
export function planLocalePathNavigation(input) {
    const routing = {
        strategy: input.routing?.strategy || 'prefix',
        defaultPrefix: input.routing?.defaultPrefix || 'include',
        defaultLocale: input.defaultLocale,
    };
    const parsed = parseLocaleFromPath(input.pathname, input.supportedLocales);
    const negotiated = negotiateLocale({
        supportedLocales: input.supportedLocales,
        defaultLocale: input.defaultLocale,
        routeLocale: parsed.localeId,
        userChoice: input.userChoice,
        preference: input.preference,
        hostCandidates: input.hostCandidates,
    });

    /** @type {any[]} */
    const diagnostics = [];
    let redirectTo = null;

    if (routing.strategy === 'prefix' && routing.defaultPrefix === 'omit') {
        // Prefixed default locale must redirect to unprefixed canonical.
        if (parsed.localeId === input.defaultLocale) {
            redirectTo = parsed.restPath;
        }
        // Unprefixed path is always defaultLocale content — Accept-Language must not steal.
        if (!parsed.localeId && negotiated !== input.defaultLocale && !input.userChoice && !input.preference) {
            // Host candidates alone cannot rewrite unprefixed default path content.
            // negotiated falls back through hostCandidates; force default for this URL.
        }
    }

    if (routing.strategy === 'prefix' && routing.defaultPrefix === 'omit' && parsed.localeId === input.defaultLocale) {
        if (!redirectTo) {
            diagnostics.push({
                code: DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT,
                severity: 'error',
                message: `default locale ${input.defaultLocale} prefixed URL lacks redirect to canonical`,
            });
        }
    }

    const realized = realizeRoutePath(negotiated, parsed.localeId ? parsed.restPath : parsed.restPath, routing);

    return {
        schema: LOCALE_ROUTER_CHECK_SCHEMA,
        kind: 'path_navigation',
        pathname: normalizePath(input.pathname),
        routeLocale: parsed.localeId,
        negotiatedLocale: negotiated,
        restPath: parsed.restPath,
        redirectTo,
        realizedPath: realized.path,
        diagnostics,
        // Unprefixed public path is bound to defaultLocale when omit — not Accept-Language.
        contentLocale: routing.defaultPrefix === 'omit' && !parsed.localeId ? input.defaultLocale : negotiated,
    };
}

/**
 * Locale-aware cache key — must include LocaleId so Accept-Language cannot steal content.
 * @param {{ routeId: string, localeId: string, path: string }} input
 */
export function localeAwareCacheKey(input) {
    return `locale=${input.localeId}|route=${input.routeId}|path=${normalizePath(input.path)}`;
}

/**
 * Reject Vary: Accept-Language on a cache key that does not encode LocaleId.
 * @param {{ cacheKey: string, varyAcceptLanguage?: boolean, localeId?: string }} input
 */
export function assertLocaleCacheKey(input) {
    /** @type {any[]} */
    const diagnostics = [];
    const key = String(input.cacheKey || '');
    const hasLocale = /(?:^|[|&])locale=/.test(key) || (input.localeId && key.includes(input.localeId));
    if (input.varyAcceptLanguage && !hasLocale) {
        diagnostics.push({
            code: DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT,
            severity: 'error',
            message: 'public cache key must include LocaleId; Accept-Language alone must not swap body',
        });
    }
    return { ok: diagnostics.length === 0, diagnostics };
}

/**
 * LocaleTransition must commit Route realization + PageMeta together.
 * @param {{
 * fromLocale: string,
 * toLocale: string,
 * routeId: string,
 * realizations: Array<{ routeId: string, localeId: string, path: string }>,
 * pageMetaByLocale: Record<string, { locale: string, canonical: string }>,
 * }} input
 */
export function commitLocaleRouteMetaTransition(input) {
    /** @type {any[]} */
    const diagnostics = [];
    const fromPath = (input.realizations || []).find((r) => r.routeId === input.routeId && r.localeId === input.fromLocale)?.path;
    const toPath = (input.realizations || []).find((r) => r.routeId === input.routeId && r.localeId === input.toLocale)?.path;
    const meta = input.pageMetaByLocale?.[input.toLocale];
    if (!toPath) {
        diagnostics.push({
            code: DIAG_LOCALE_CANONICAL_MISSING,
            severity: 'error',
            message: `transition missing realization ${input.routeId}@${input.toLocale}`,
        });
    }
    if (!meta?.canonical) {
        diagnostics.push({
            code: DIAG_LOCALE_CANONICAL_MISSING,
            severity: 'error',
            message: `transition missing PageMeta canonical for ${input.toLocale}`,
        });
    }
    if (meta && meta.locale !== input.toLocale) {
        diagnostics.push({
            code: DIAG_LOCALE_META_LOCALE_MISMATCH,
            severity: 'error',
            message: `PageMeta.locale ${meta.locale} != transition ${input.toLocale}`,
        });
    }
    return {
        schema: LOCALE_ROUTER_CHECK_SCHEMA,
        kind: 'locale_route_meta_transition',
        status: diagnostics.length ? 'failed' : 'committed',
        fromLocale: input.fromLocale,
        toLocale: input.toLocale,
        fromPath,
        toPath,
        pageMeta: meta || null,
        diagnostics,
    };
}

/**
 * Aggregate router/meta proof.
 * @param {{
 * manifest: {
 * defaultLocale: string,
 * locales: Array<{ id: string, direction?: string }>,
 * routing?: { strategy?: string, defaultPrefix?: string },
 * },
 * routes: Array<{ routeId: string, path: string }>,
 * titles?: Record<string, Record<string, string>>,
 * origin?: string,
 * }} input
 */
export function checkLocaleRouter(input) {
    /** @type {any[]} */
    const diagnostics = [];
    const locales = (input.manifest?.locales || []).map((l) => l.id);
    const directions = Object.fromEntries((input.manifest?.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const defaultLocale = input.manifest?.defaultLocale;
    const table = buildLocaleRouteRealizationTable({
        routes: input.routes,
        locales,
        defaultLocale,
        routing: input.manifest?.routing,
    });
    diagnostics.push(...table.diagnostics);

    const origin = input.origin || 'https://example.test';
    /** @type {any[]} */
    const pageMetas = [];
    for (const route of input.routes || []) {
        for (const loc of locales) {
            const title = input.titles?.[route.routeId]?.[loc] || input.titles?.[route.routeId]?.[defaultLocale] || route.routeId;
            const meta = buildLocalePageMeta({
                routeId: route.routeId,
                localeId: loc,
                direction: directions[loc],
                title,
                origin,
                realizations: table.realizations,
                locales,
                defaultLocale,
            });
            diagnostics.push(...meta.diagnostics);
            if (meta.locale !== loc) {
                diagnostics.push({
                    code: DIAG_LOCALE_META_LOCALE_MISMATCH,
                    severity: 'error',
                    message: `PageMeta.locale ${meta.locale} != ${loc}`,
                });
            }
            pageMetas.push(meta);
        }
    }

    // omit-prefix requires redirect plan for prefixed default locale URLs
    if (input.manifest?.routing?.defaultPrefix === 'omit') {
        const sample = input.routes?.[0];
        if (sample) {
            const prefixedDefault = `/${defaultLocale}${normalizePath(sample.path)}`;
            const nav = planLocalePathNavigation({
                pathname: prefixedDefault,
                supportedLocales: locales,
                defaultLocale,
                routing: input.manifest.routing,
            });
            if (!nav.redirectTo) {
                diagnostics.push({
                    code: DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT,
                    severity: 'error',
                    message: `omit defaultPrefix requires redirect from ${prefixedDefault}`,
                });
            }
            diagnostics.push(...nav.diagnostics);
        }
    }

    // Cache key must encode locale
    const sampleReal = table.realizations[0];
    if (sampleReal) {
        const goodKey = localeAwareCacheKey({
            routeId: sampleReal.routeId,
            localeId: sampleReal.localeId,
            path: sampleReal.path,
        });
        const good = assertLocaleCacheKey({ cacheKey: goodKey, varyAcceptLanguage: true, localeId: sampleReal.localeId });
        diagnostics.push(...good.diagnostics);
        const bad = assertLocaleCacheKey({
            cacheKey: `route=${sampleReal.routeId}|path=${sampleReal.path}`,
            varyAcceptLanguage: true,
        });
        // Expected failure — record as proof probe, not as check failure if we only assert detection.
        if (bad.ok) {
            diagnostics.push({
                code: DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT,
                severity: 'error',
                message: 'cache key probe failed to detect Accept-Language steal',
            });
        }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    return {
        schema: LOCALE_ROUTER_CHECK_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        realizationTable: table,
        pageMetas,
        diagnostics,
    };
}

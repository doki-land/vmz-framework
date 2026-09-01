/**
 * Plan-native locale link rewrite for serve-host and static-emit.
 * Href authority is RouteId × LocaleId realization rows — not path parsing on existing href.
 */

export const LOCALE_LINK_PLAN_SCHEMA = 'vmz.static.locale_link_plan.v0';

export type LinkRouteAlias = {
    /** Author Link `to` / `data-vmz-route` (class RouteId, e.g. IndexPage). */
    linkRouteId: string;
    /** Locale realization `routeId` (often chunk path, e.g. pages/index). */
    realizationRouteId: string;
};

export type LocaleHrefArtifact = {
    locales?: Array<{ id: string } | string>;
    defaultLocale?: string;
    routing?: { strategy?: string; defaultPrefix?: string; defaultLocale?: string };
    realizations?: Array<{ routeId: string; localeId: string; path: string }>;
    /**
     * Bridge author Link RouteId ↔ realization routeId.
     * Realization artifacts historically key by chunk path; Links emit class names.
     */
    linkRouteAliases?: LinkRouteAlias[];
};

export type LocaleLinkPlanRow = {
    routeId: string;
    localeId: string;
    href: string;
};

export type LocaleLinkPlan = {
    schema: typeof LOCALE_LINK_PLAN_SCHEMA;
    rows: LocaleLinkPlanRow[];
};

/** Build Link RouteId aliases from deployment page units (`routeId` + `chunkId`). */
export function linkRouteAliasesFromUnits(
    units: Array<{ kind?: string; routeId?: string; chunkId?: string }> | null | undefined,
): LinkRouteAlias[] {
    const out: LinkRouteAlias[] = [];
    const seen = new Set<string>();
    for (const unit of units || []) {
        if (unit?.kind && unit.kind !== 'page') continue;
        const linkRouteId = typeof unit?.routeId === 'string' ? unit.routeId.trim() : '';
        const realizationRouteId = typeof unit?.chunkId === 'string' ? unit.chunkId.replace(/\\/g, '/').trim() : '';
        if (!linkRouteId || !realizationRouteId || linkRouteId === realizationRouteId) continue;
        const key = `${linkRouteId}\0${realizationRouteId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ linkRouteId, realizationRouteId });
    }
    return out;
}

/** Build RouteId × LocaleId → href rows from locale route realization artifact. */
export function buildLocaleLinkPlan(artifact: LocaleHrefArtifact | null | undefined): LocaleLinkPlan {
    const rows: LocaleLinkPlanRow[] = [];
    const aliases = artifact?.linkRouteAliases || [];
    for (const r of artifact?.realizations || []) {
        if (!r?.routeId || !r?.localeId || !r?.path) continue;
        const realizationRouteId = String(r.routeId);
        const localeId = String(r.localeId);
        const href = String(r.path);
        rows.push({ routeId: realizationRouteId, localeId, href });
        for (const alias of aliases) {
            if (alias.realizationRouteId === realizationRouteId && alias.linkRouteId) {
                rows.push({ routeId: String(alias.linkRouteId), localeId, href });
            }
        }
    }
    rows.sort((a, b) => (a.routeId === b.routeId ? a.localeId.localeCompare(b.localeId) : a.routeId.localeCompare(b.routeId)));
    return { schema: LOCALE_LINK_PLAN_SCHEMA, rows };
}

/** Apply plan rows to `<a data-vmz-route="RouteId">` markers for one LocaleId. */
export function applyLocaleLinkPlan(
    html: string,
    localeId: string,
    plan: LocaleLinkPlan,
    escapeAttr: (s: string) => string = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
): string {
    if (!html || !localeId || !plan?.rows?.length) return html;
    const byRoute = new Map<string, string>();
    for (const row of plan.rows) {
        if (row.localeId === localeId) byRoute.set(row.routeId, row.href);
    }
    if (!byRoute.size) return html;
    return String(html).replace(/<a\b([^>]*)>/gi, (full, attrs) => {
        const rm = attrs.match(/\bdata-vmz-route\s*=\s*"([^"]*)"/i);
        if (!rm) return full;
        const href = byRoute.get(rm[1]);
        if (!href) return full;
        // Realization rows for dynamic routes keep unresolved patterns (`[id]` / `:id`).
        // Do not clobber compile-time realized hrefs like `/products/sku-1`.
        if (/\[[^\]]+\]/.test(href) || /\/:[^/]+/.test(href)) return full;
        const hm = attrs.match(/\bhref\s*=\s*"([^"]*)"/i);
        if (hm && hm[1] === href) return full;
        const newAttrs = hm ? attrs.replace(/\bhref\s*=\s*"[^"]*"/i, `href="${escapeAttr(href)}"`) : ` href="${escapeAttr(href)}"${attrs}`;
        return `<a${newAttrs}>`;
    });
}

/** Rewrite `<a data-vmz-route href>` using locale realization plan (Plan-native). */
export function localizeBodyLinks(html: string, localeId: string, artifact: LocaleHrefArtifact, escapeAttr?: (s: string) => string): string {
    if (!html || !localeId || !artifact) return html;
    return applyLocaleLinkPlan(html, localeId, buildLocaleLinkPlan(artifact), escapeAttr);
}

function normalizePath(pathname: string): string {
    let p = String(pathname || '/');
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
}

/** Legacy same-app href helper for callers without `data-vmz-route` markers. */
export function localizeSameAppHref(href: string, localeId: string, artifact: LocaleHrefArtifact): string {
    if (!href || !localeId || !artifact) return href;
    if (href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) return href;
    const plan = buildLocaleLinkPlan(artifact);
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
    pathname = normalizePath(pathname || '/');
    for (const row of plan.rows) {
        if (row.localeId !== localeId) continue;
        if (normalizePath(row.href) === pathname) return `${row.href}${search}${hash}`;
    }
    return href;
}

/**
 * Single HTML `<a data-vmz-route>` locale rewrite for serve-host and static-emit.
 * Plan-only hosts must not keep a second copy of this semantic (0.1.22).
 */

export type LocaleHrefArtifact = {
    locales?: Array<{ id: string } | string>;
    defaultLocale?: string;
    routing?: { strategy?: string; defaultPrefix?: string; defaultLocale?: string };
};

function normalizePath(pathname: string): string {
    let p = String(pathname || '/');
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
}

function parseLocaleFromPath(pathname: string, supportedLocales: string[]) {
    const parts = normalizePath(pathname).split('/').filter(Boolean);
    if (!parts.length) return { localeId: null as string | null, restPath: '/' };
    if (supportedLocales.includes(parts[0])) {
        const rest = parts.slice(1);
        return { localeId: parts[0], restPath: rest.length ? `/${rest.join('/')}` : '/' };
    }
    return { localeId: null as string | null, restPath: normalizePath(pathname) };
}

function realizeRoutePath(
    localeId: string,
    pathPattern: string,
    routing: { strategy?: string; defaultPrefix?: string; defaultLocale?: string },
) {
    const strategy = routing.strategy || 'prefix';
    const defaultPrefix = routing.defaultPrefix || 'include';
    const defaultLocale = routing.defaultLocale;
    const base = normalizePath(pathPattern);

    if (strategy === 'none' || strategy === 'domain') {
        return { path: base };
    }

    const omitDefault = defaultPrefix === 'omit' && localeId === defaultLocale;
    if (omitDefault) {
        return { path: base };
    }
    const pathOut = base === '/' ? `/${localeId}` : `/${localeId}${base}`;
    return { path: pathOut };
}

/** Rewrite a same-app href to the given LocaleId via route realization. */
export function localizeSameAppHref(href: string, localeId: string, artifact: LocaleHrefArtifact): string {
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

/** Rewrite `<a data-vmz-route href>` in HTML body to retain `localeId`. */
export function localizeBodyLinks(
    html: string,
    localeId: string,
    artifact: LocaleHrefArtifact,
    escapeAttr: (s: string) => string = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
): string {
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

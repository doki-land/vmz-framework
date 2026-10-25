export function applyLocaleRealization(doc: Document, root: Element | null) {
    if (!root || !doc?.documentElement) return null;
    const locale = root.getAttribute('data-vmz-locale');
    const dir = root.getAttribute('data-vmz-dir');
    if (locale) {
        doc.documentElement.setAttribute('data-locale', locale);
        doc.documentElement.lang = locale;
    }
    if (dir) doc.documentElement.dir = dir;
    return locale;
}

export type LocaleTransitionEnv = {
    document: Document;
    window: Window | null;
    location: Location;
    transitionTo: (url: string | URL, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export function createLocaleTransition({ document: doc, window: win, location: loc, transitionTo }: LocaleTransitionEnv) {
    let localeTransitionGeneration = 0;

    function readLocaleRouting() {
        const raw = doc.documentElement?.getAttribute('data-vmz-locale-routing');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function readLocaleHrefTable() {
        const raw = doc.documentElement?.getAttribute('data-vmz-locale-hrefs');
        if (!raw) return null;
        try {
            const table = JSON.parse(raw);
            return table && typeof table === 'object' ? table : null;
        } catch {
            return null;
        }
    }

    function lookupFrozenLocaleHref(routeId: string | null, localeId: string | null) {
        if (!routeId || !localeId) return null;
        const table = readLocaleHrefTable();
        const href = table?.[routeId]?.[localeId];
        return typeof href === 'string' && href && !/\[[^\]]+\]/.test(href) && !/\/:[^/]+/.test(href) ? href : null;
    }

    function resolveRouteIdFromHrefTable(pathname: string, localeId: string | null) {
        const table = readLocaleHrefTable();
        if (!table || !localeId) return null;
        const norm = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname || '/';
        for (const [routeId, byLocale] of Object.entries(table)) {
            const href = (byLocale as Record<string, string>)?.[localeId];
            if (typeof href !== 'string') continue;
            const h = href.length > 1 && href.endsWith('/') ? href.slice(0, -1) : href;
            if (h === norm) return routeId;
        }
        return null;
    }

    function realizePathForLocale(href: string, localeId: string, routing: Record<string, unknown>) {
        let pathname = href;
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

        const fromLocale = doc.documentElement?.getAttribute('data-locale') || null;
        const routeId =
            doc.documentElement?.getAttribute('data-vmz-route') ||
            doc.querySelector?.('[data-vmz-app][data-vmz-route]')?.getAttribute?.('data-vmz-route') ||
            resolveRouteIdFromHrefTable(pathname, fromLocale);
        const frozen = lookupFrozenLocaleHref(routeId, localeId);
        if (frozen) return `${frozen}${search}${hash}`;

        const supported = Array.isArray(routing.locales) ? routing.locales : [];
        const parts = pathname.split('/').filter(Boolean);
        let rest = pathname;
        if (parts.length && supported.includes(parts[0])) {
            const r = parts.slice(1);
            rest = r.length ? `/${r.join('/')}` : '/';
        }
        if (rest.length > 1 && rest.endsWith('/')) rest = rest.slice(0, -1);
        if (!rest.startsWith('/')) rest = `/${rest}`;
        const strategy = routing.strategy || 'prefix';
        const defaultPrefix = routing.defaultPrefix || 'include';
        const defaultLocale = routing.defaultLocale;
        if (strategy === 'none' || strategy === 'domain') return `${rest}${search}${hash}`;
        if (defaultPrefix === 'omit' && localeId === defaultLocale) return `${rest}${search}${hash}`;
        const pathOut = rest === '/' ? `/${localeId}` : `/${localeId}${rest}`;
        return `${pathOut}${search}${hash}`;
    }

    function localizeClickHref(href: string, routeId: string | null) {
        if (!doc?.documentElement) return href;
        const locale = doc.documentElement.getAttribute('data-locale');
        if (!locale) return href;

        const frozen = lookupFrozenLocaleHref(routeId, locale);
        if (frozen) {
            let search = '';
            let hash = '';
            const hashIdx = href.indexOf('#');
            let pathPart = href;
            if (hashIdx >= 0) {
                hash = pathPart.slice(hashIdx);
                pathPart = pathPart.slice(0, hashIdx);
            }
            const qIdx = pathPart.indexOf('?');
            if (qIdx >= 0) {
                search = pathPart.slice(qIdx);
            }
            return `${frozen}${search}${hash}`;
        }

        const raw = doc.documentElement.getAttribute('data-vmz-locale-routing');
        if (!raw) return href;
        let routing: Record<string, unknown>;
        try {
            routing = JSON.parse(raw);
        } catch {
            return href;
        }
        const supported = Array.isArray(routing.locales) ? routing.locales : [];
        const defaultLocale = routing.defaultLocale;
        let pathname = href;
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
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length && supported.includes(parts[0])) {
            return `${pathname}${search}${hash}`;
        }
        let rest = pathname;
        if (rest.length > 1 && rest.endsWith('/')) rest = rest.slice(0, -1);
        if (!rest.startsWith('/')) rest = `/${rest}`;
        const strategy = routing.strategy || 'prefix';
        const defaultPrefix = routing.defaultPrefix || 'include';
        if (strategy === 'none' || strategy === 'domain') return `${rest}${search}${hash}`;
        if (defaultPrefix === 'omit' && locale === defaultLocale) return `${rest}${search}${hash}`;
        const pathOut = rest === '/' ? `/${locale}` : `/${locale}${rest}`;
        return `${pathOut}${search}${hash}`;
    }

    function transitionLocaleNone(toLocale: string, fromLocale: string | null, opts: Record<string, unknown> = {}) {
        const STORE_KEY = 'vmz.locale';
        try {
            try {
                localStorage.setItem(STORE_KEY, toLocale);
            } catch {
                /* private mode */
            }
            try {
                doc.cookie = `${STORE_KEY}=${encodeURIComponent(toLocale)}; path=/; max-age=31536000; SameSite=Lax`;
            } catch {
                /* ignore */
            }
            if (doc.documentElement) {
                doc.documentElement.setAttribute('data-locale', toLocale);
                doc.documentElement.setAttribute('lang', toLocale);
            }
            if (win) win.__vmzLocaleIdHint = toLocale;
        } catch (err) {
            const out = {
                status: 'rolled_back',
                fromLocale,
                toLocale,
                reason: 'persist_failed',
                detail: err && (err as Error).message ? String((err as Error).message) : String(err),
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }

        const out = {
            status: 'committed',
            fromLocale,
            toLocale,
            reason: 'ok',
            strategy: 'none',
            href: loc.pathname + loc.search,
            reload: opts.reload !== false,
        };
        if (win) win.__vmzLastLocaleTransition = out;
        if (opts.reload !== false && loc && typeof loc.reload === 'function') {
            loc.reload();
        }
        return out;
    }

    async function transitionLocale(toLocale: string, opts: Record<string, unknown> = {}) {
        const fromLocale = doc.documentElement?.getAttribute('data-locale') || null;
        const routing = readLocaleRouting();
        if (!routing) {
            const out = {
                status: 'rejected',
                fromLocale,
                toLocale,
                reason: 'missing_routing',
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }
        const supported = Array.isArray(routing.locales) ? routing.locales : [];
        if (!supported.includes(toLocale)) {
            const out = {
                status: 'rejected',
                fromLocale,
                toLocale,
                reason: 'unsupported',
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }
        if (toLocale === fromLocale) {
            const out = {
                status: 'committed',
                fromLocale,
                toLocale,
                reason: 'noop',
                href: loc.pathname + loc.search,
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }

        const strategy = routing.strategy || 'prefix';
        if (strategy === 'none') {
            return transitionLocaleNone(toLocale, fromLocale, opts);
        }

        const gen = ++localeTransitionGeneration;
        const targetHref = realizePathForLocale(loc.pathname + loc.search + loc.hash, toLocale, routing);
        const result = await transitionTo(targetHref, { replace: opts.replace !== false, softFail: true });

        if (gen !== localeTransitionGeneration) {
            const out = {
                status: 'cancelled',
                fromLocale,
                toLocale,
                reason: 'stale_generation',
                href: targetHref,
                generation: gen,
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }

        if (!result?.ok) {
            const still = doc.documentElement?.getAttribute('data-locale');
            const out = {
                status: 'rolled_back',
                fromLocale,
                toLocale,
                reason: result?.reason || 'nav_failed',
                href: targetHref,
                retainedLocale: still,
                generation: gen,
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }

        const committed = doc.documentElement?.getAttribute('data-locale');
        if (committed !== toLocale) {
            const out = {
                status: 'failed',
                fromLocale,
                toLocale,
                reason: 'partial',
                href: targetHref,
                committedLocale: committed,
                generation: gen,
            };
            if (win) win.__vmzLastLocaleTransition = out;
            return out;
        }

        const out = {
            status: 'committed',
            fromLocale,
            toLocale,
            reason: 'ok',
            href: targetHref,
            generation: gen,
        };
        if (win) win.__vmzLastLocaleTransition = out;
        return out;
    }

    return { transitionLocale, localizeClickHref };
}

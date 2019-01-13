/**
 * Browser client navigation — same-app `<Link>` SPA takeover.
 * Zero-JS still works via real `<a href>`; with JS, intercept same-origin
 * `a[data-vmz-route]` clicks, pushState, fetch SSR HTML, swap page (retain layout
 * when `data-vmz-layout` is unchanged) or full `#app`, then hydrate.
 */
// @ts-nocheck

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   document?: Document,
 *   history?: History,
 *   location?: Location,
 *   hydrate?: (Ctor: any, root: Element, props: object) => Promise<unknown>,
 *   hydrateRoute?: (Page: any, root: Element, props: object, layouts?: any[]) => Promise<unknown>,
 *   hydrateRoutePage?: (Page: any, root: Element, props: object) => Promise<unknown>,
 *   destroy?: (inst: object) => void,
 *   importPage?: (chunkId: string) => Promise<any>,
 * }} [opts]
 */
export function installClientNavigation(opts = {}) {
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    const win = typeof window !== 'undefined' ? window : null;
    const hist = opts.history || win?.history;
    const loc = opts.location || win?.location;
    const fetchImplDefault = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    /** @type {typeof fetch | null} */
    let fetchImpl = fetchImplDefault;
    if (!doc || !hist || !loc || !fetchImpl) {
        return { ok: false, reason: 'missing document/history/fetch' };
    }

    if (win && !win.__vmzBootId) {
        win.__vmzBootId = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    if (win) win.__vmzClientNavInstalled = true;
    // Route Transition Plan owns scroll; disable browser's automatic restoration.
    try {
        if (hist && 'scrollRestoration' in hist) hist.scrollRestoration = 'manual';
    } catch {
        /* ignore */
    }

    /** @type {AbortController | null} */
    let inflight = null;
    let navigating = false;
    /** @type {Map<string, { x: number, y: number }>} */
    const scrollPositions = new Map();

    function destroyInst(inst) {
        if (!inst) return;
        if (typeof opts.destroy === 'function') opts.destroy(inst);
        else if (win?.vmzDestroy) win.vmzDestroy(inst);
    }

    async function loadDomFallback() {
        return import(/* @vite-ignore */ '/dom.browser.js');
    }

    function navKey(pathname, search) {
        return `${pathname || '/'}${search || ''}`;
    }

    function saveScroll() {
        if (!win) return;
        scrollPositions.set(navKey(loc.pathname, loc.search), {
            x: win.scrollX || 0,
            y: win.scrollY || 0,
        });
    }

    /**
     * Route Transition Plan: restore scroll on popstate; forward nav → hash or top.
     * Re-applies across frames until scrollHeight can hold the saved Y (hydrate settle).
     * @param {URL} target
     * @param {boolean} fromPop
     */
    async function restoreScroll(target, fromPop) {
        if (!win) return { mode: 'none', x: 0, y: 0 };
        const frame = () =>
            new Promise((resolve) => {
                if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(resolve);
                else setTimeout(resolve, 0);
            });
        if (fromPop) {
            const saved = scrollPositions.get(navKey(target.pathname, target.search));
            if (saved) {
                const apply = () => {
                    try {
                        win.scrollTo(saved.x, saved.y);
                    } catch {
                        /* ignore */
                    }
                };
                // Do not claim restored until window.scrollY actually tracks (or we exhaust retries).
                for (let i = 0; i < 12; i++) {
                    apply();
                    const y = win.scrollY || 0;
                    if (Math.abs(y - saved.y) <= 2) break;
                    const docEl = doc.documentElement || doc.body;
                    const maxY = Math.max(0, (docEl?.scrollHeight || 0) - (win.innerHeight || 0));
                    // Document still short — wait for hydrate/layout to grow scrollHeight.
                    if (maxY + 2 < saved.y) {
                        await frame();
                        continue;
                    }
                    // Tall enough but not yet at target (rare paint lag).
                    await frame();
                }
                apply();
                return { mode: 'restored', x: saved.x, y: win.scrollY || saved.y };
            }
        }
        if (target.hash) {
            const id = decodeURIComponent(target.hash.slice(1));
            const el = id ? doc.getElementById(id) : null;
            if (el && typeof el.scrollIntoView === 'function') {
                el.scrollIntoView();
                return { mode: 'hash', x: win.scrollX || 0, y: win.scrollY || 0 };
            }
        }
        win.scrollTo(0, 0);
        return { mode: 'top', x: 0, y: 0 };
    }

    /**
     * Focus the primary page landmark after SPA swap (not a scattered runtime hook).
     * @param {Element | null} root
     * @param {URL} target
     */
    function restoreFocus(root, target) {
        if (!root || !doc) return null;
        let el = null;
        if (target.hash) {
            const id = decodeURIComponent(target.hash.slice(1));
            el = id ? doc.getElementById(id) : null;
        }
        if (!el) el = root.querySelector('[data-vmz-focus]');
        if (!el) el = root.querySelector('main, h1, [role="main"]');
        if (!el) el = root;
        if (el === doc.body) return null;
        const focusable = /** @type {HTMLElement} */ (el);
        if (!focusable.hasAttribute('tabindex') && focusable.tabIndex < 0) {
            focusable.setAttribute('tabindex', '-1');
        }
        try {
            focusable.focus({ preventScroll: true });
        } catch {
            /* ignore — never focus() without preventScroll (would steal restored scrollY) */
        }
        return focusable.getAttribute('data-vmz-focus') || focusable.tagName?.toLowerCase() || null;
    }

    /**
     * Apply locale realization attributes from SSR `#app` onto `<html>`.
     * @param {Element | null} root
     */
    function applyLocaleRealization(root) {
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

    async function transitionTo(url, { replace = false, fromPop = false, softFail = false } = {}) {
        const target = new URL(url, loc.href);
        if (target.origin !== loc.origin) {
            loc.assign(target.href);
            return { ok: false, reason: 'cross-origin' };
        }

        if (!fromPop) saveScroll();

        if (inflight) inflight.abort();
        inflight = new AbortController();
        const signal = inflight.signal;
        navigating = true;
        try {
            const res = await fetchImpl(target.pathname + target.search, {
                method: 'GET',
                headers: { accept: 'text/html', 'x-vmz-client-nav': '1' },
                signal,
            });
            if (!res.ok) {
                // LocaleTransition uses softFail — keep current surface (no full assign).
                if (!fromPop && !softFail) loc.assign(target.href);
                return { ok: false, reason: `http ${res.status}` };
            }
            const html = await res.text();
            const nextApp = extractAppHtml(html, doc);
            if (!nextApp) {
                if (!fromPop && !softFail) loc.assign(target.href);
                return { ok: false, reason: 'missing #app in response' };
            }

            const root = doc.getElementById('app');
            if (!root) {
                if (!fromPop && !softFail) loc.assign(target.href);
                return { ok: false, reason: 'missing #app' };
            }

            const prevLayout = parseLayoutChain(root.getAttribute('data-vmz-layout'));
            const nextLayout = parseLayoutChain(nextApp.getAttribute('data-vmz-layout'));
            const retainLayouts = canRetainLayouts(root, prevLayout, nextLayout);

            const chunkId = nextApp.getAttribute('data-vmz-page') || '';
            let props = {};
            try {
                const raw = nextApp.getAttribute('data-vmz-props');
                if (raw) props = JSON.parse(raw);
            } catch {
                /* ignore */
            }

            if (!fromPop) {
                if (replace) hist.replaceState({ vmzClientNav: true }, '', target.href);
                else hist.pushState({ vmzClientNav: true }, '', target.href);
            }

            const importChunk = opts.importPage || (async (id) => (await import(/* @vite-ignore */ `/${id}.client.js`)).default);

            /** @type {Element | null} */
            let liveRoot = root;
            let retainedLayout = false;

            // Apply target LocaleId before hydrate/onMount so `#locales/*` and
            // retained shells (SiteHeader) see the committed projection.
            applyLocaleRealization(nextApp);

            if (retainLayouts) {
                applyAppAttrs(root, nextApp);
                if (chunkId) {
                    const Page = await importChunk(chunkId);
                    let hydrateRoutePage = opts.hydrateRoutePage;
                    if (typeof hydrateRoutePage !== 'function') {
                        const dom = await loadDomFallback();
                        hydrateRoutePage = dom.hydrateRoutePage;
                    }
                    if (typeof hydrateRoutePage === 'function') {
                        await hydrateRoutePage(Page, root, props);
                    } else {
                        let hydrate = opts.hydrate;
                        if (typeof hydrate !== 'function') {
                            const dom = await loadDomFallback();
                            hydrate = dom.hydrate;
                        }
                        const pageHost = root.__vmzPageHost || root;
                        if (pageHost.__vmzInst) destroyInst(pageHost.__vmzInst);
                        await hydrate(Page, pageHost, props);
                        root.__vmzPageHost = pageHost;
                        if (!root.__vmzLayoutInsts?.length) root.__vmzInst = pageHost.__vmzInst;
                    }
                }
                retainedLayout = true;
            } else {
                // Dispose previous Direct instance if present (full #app swap).
                const prev = root.__vmzInst;
                destroyInst(prev);
                root.__vmzInst = null;
                root.__vmzPageHost = null;
                root.__vmzLayoutInsts = null;

                root.outerHTML = nextApp.outerHTML;
                const fresh = doc.getElementById('app');
                if (!fresh) return { ok: false, reason: 'swap lost #app' };
                liveRoot = fresh;

                if (chunkId) {
                    const Page = await importChunk(chunkId);
                    /** @type {any[]} */
                    const layoutCtors = [];
                    for (const id of nextLayout) {
                        layoutCtors.push(await importChunk(id));
                    }
                    let hydrateRoute = opts.hydrateRoute;
                    if (typeof hydrateRoute !== 'function') {
                        const dom = await loadDomFallback();
                        hydrateRoute = dom.hydrateRoute;
                    }
                    if (typeof hydrateRoute === 'function') {
                        await hydrateRoute(Page, fresh, props, layoutCtors);
                    } else {
                        let hydrate = opts.hydrate;
                        if (typeof hydrate !== 'function') {
                            const dom = await loadDomFallback();
                            hydrate = dom.hydrate;
                        }
                        await hydrate(Page, fresh, props);
                    }
                }
            }

            const localeId = applyLocaleRealization(liveRoot);
            const focusTarget = restoreFocus(liveRoot, target);

            if (win) {
                win.__vmzClientNavCount = (win.__vmzClientNavCount || 0) + 1;
                win.__vmzLastClientNav = {
                    href: target.pathname + target.search,
                    routeId: liveRoot?.getAttribute?.('data-vmz-route') || nextApp.getAttribute?.('data-vmz-route') || null,
                    chunkId,
                    bootId: win.__vmzBootId,
                    retainedLayout,
                    focusTarget,
                    localeId,
                    // Pending until restoreScroll finishes — never lie as "restored" early (gate race).
                    scrollMode: 'pending',
                    scrollY: null,
                };
            }

            // Wait for hydrate/layout paint before applying scroll — otherwise scrollTo is clamped/reset.
            if (win && typeof win.requestAnimationFrame === 'function') {
                await new Promise((resolve) => {
                    win.requestAnimationFrame(() => win.requestAnimationFrame(resolve));
                });
            }
            const scroll = await restoreScroll(target, fromPop);
            if (win && win.__vmzLastClientNav) {
                win.__vmzLastClientNav.scrollMode = scroll.mode;
                win.__vmzLastClientNav.scrollY = scroll.y;
            }

            return {
                ok: true,
                href: target.pathname + target.search,
                chunkId,
                retainedLayout,
                scrollMode: scroll.mode,
                focusTarget,
                localeId,
            };
        } finally {
            navigating = false;
        }
    }

    function onClick(ev) {
        if (navigating) return;
        if (ev.defaultPrevented) return;
        if (ev.button !== 0) return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        const a = ev.target?.closest?.('a[data-vmz-route][href]');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
        const u = new URL(href, loc.href);
        if (u.origin !== loc.origin) return;
        // Download / new tab
        if (a.hasAttribute('download') || a.getAttribute('target') === '_blank') return;

        ev.preventDefault();
        // Prefer frozen RouteId×LocaleId href table (0.1.30); fall back only when table missing.
        const realized = localizeClickHref(u.pathname + u.search + u.hash, a.getAttribute('data-vmz-route'));
        void transitionTo(realized, {
            replace: a.getAttribute('data-vmz-replace') === 'true',
        });
    }

    /**
     * @param {string} href
     * @param {string | null} [routeId]
     */
    function localizeClickHref(href, routeId) {
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
        let routing;
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
        // Explicit locale prefix in href = intentional locale (switch/deep-link) — do not rewrite.
        if (parts.length && supported.includes(parts[0])) {
            return `${pathname}${search}${hash}`;
        }
        // Unprefixed same-app Link → realize with current LocaleId.
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

    function onPopState() {
        void transitionTo(loc.pathname + loc.search + loc.hash, { fromPop: true });
    }

    /** @type {number} */
    let localeTransitionGeneration = 0;

    /**
     * Atomic LocaleTransition (browser host slice):
     * - prefix: validate → realize path → navigate/fetch → commit locale attrs from SSR HTML
     * - none: validate → Host persist (localStorage+cookie) → commit attrs → reload (v1; no URL rewrite)
     * Failure keeps the previous locale surface (no half-page commit).
     * @param {string} toLocale
     * @param {{ replace?: boolean, reload?: boolean }} [opts]
     */
    async function transitionLocale(toLocale, opts = {}) {
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
            // transitionTo does not mutate html locale attrs before success — surface stays fromLocale.
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

    /**
     * `routing.strategy: 'none'` — LocaleId is Host preference, not URL.
     * Persist → commit document attrs + hint → full reload so `#locales/*` re-resolve (I2 v1).
     * @param {string} toLocale
     * @param {string | null} fromLocale
     * @param {{ reload?: boolean }} [opts]
     */
    function transitionLocaleNone(toLocale, fromLocale, opts = {}) {
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
                detail: err && err.message ? String(err.message) : String(err),
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
        // Reload so generated `#locales` modules re-run __vmzLocaleId() with new preference.
        if (opts.reload !== false && loc && typeof loc.reload === 'function') {
            loc.reload();
        }
        return out;
    }

    /**
     * @returns {{ strategy?: string, defaultPrefix?: string, defaultLocale?: string, locales?: string[] } | null}
     */
    function readLocaleRouting() {
        const raw = doc.documentElement?.getAttribute('data-vmz-locale-routing');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Re-realize current URL under target LocaleId via frozen href table when present.
     * @param {string} href
     * @param {string} localeId
     * @param {{ strategy?: string, defaultPrefix?: string, defaultLocale?: string, locales?: string[] }} routing
     */
    function realizePathForLocale(href, localeId, routing) {
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

    /**
     * @returns {Record<string, Record<string, string>> | null}
     */
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

    /**
     * @param {string | null | undefined} routeId
     * @param {string} localeId
     */
    function lookupFrozenLocaleHref(routeId, localeId) {
        if (!routeId || !localeId) return null;
        const table = readLocaleHrefTable();
        const href = table?.[routeId]?.[localeId];
        return typeof href === 'string' && href && !/\[[^\]]+\]/.test(href) && !/\/:[^/]+/.test(href) ? href : null;
    }

    /**
     * Reverse-lookup RouteId from frozen table when html lacks data-vmz-route.
     * @param {string} pathname
     * @param {string | null} localeId
     */
    function resolveRouteIdFromHrefTable(pathname, localeId) {
        const table = readLocaleHrefTable();
        if (!table || !localeId) return null;
        const norm = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname || '/';
        for (const [routeId, byLocale] of Object.entries(table)) {
            const href = byLocale?.[localeId];
            if (typeof href !== 'string') continue;
            const h = href.length > 1 && href.endsWith('/') ? href.slice(0, -1) : href;
            if (h === norm) return routeId;
        }
        return null;
    }

    if (win) {
        win.__vmzTransitionLocale = transitionLocale;
        win.__vmzClientNavSetFetch = (fn) => {
            fetchImpl = typeof fn === 'function' ? fn : fetchImplDefault;
        };
    }

    doc.addEventListener('click', onClick);
    win?.addEventListener?.('popstate', onPopState);

    return {
        ok: true,
        transitionTo,
        transitionLocale,
        dispose() {
            doc.removeEventListener('click', onClick);
            win?.removeEventListener?.('popstate', onPopState);
            if (win && win.__vmzTransitionLocale === transitionLocale) {
                try {
                    delete win.__vmzTransitionLocale;
                } catch {
                    win.__vmzTransitionLocale = undefined;
                }
            }
            if (win) {
                try {
                    delete win.__vmzClientNavSetFetch;
                } catch {
                    win.__vmzClientNavSetFetch = undefined;
                }
            }
        },
    };
}

/**
 * @param {string | null} raw
 * @returns {string[]}
 */
function parseLayoutChain(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function layoutChainsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * @param {Element} root
 * @param {string[]} prevLayout
 * @param {string[]} nextLayout
 */
function canRetainLayouts(root, prevLayout, nextLayout) {
    if (!layoutChainsEqual(prevLayout, nextLayout)) return false;
    if (!root.__vmzPageHost) return false;
    if (nextLayout.length === 0) return true;
    const insts = root.__vmzLayoutInsts;
    return Array.isArray(insts) && insts.length === nextLayout.length;
}

/**
 * @param {Element} root
 * @param {Element} nextApp
 */
function applyAppAttrs(root, nextApp) {
    for (const name of ['data-vmz-page', 'data-vmz-props', 'data-vmz-layout', 'data-vmz-route', 'data-vmz-locale', 'data-vmz-dir']) {
        const v = nextApp.getAttribute(name);
        if (v == null) root.removeAttribute(name);
        else root.setAttribute(name, v);
    }
}

/**
 * @param {string} html
 * @param {Document} doc
 */
export function extractAppHtml(html, doc) {
    const parser = new (doc.defaultView?.DOMParser || globalThis.DOMParser)();
    const parsed = parser.parseFromString(html, 'text/html');
    return parsed.getElementById('app');
}

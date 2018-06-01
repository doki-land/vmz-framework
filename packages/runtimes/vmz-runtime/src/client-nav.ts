/**
 * Browser client navigation — same-app `<Link>` SPA takeover.
 * Zero-JS still works via real `<a href>`; with JS, intercept same-origin
 * `a[data-vmz-route]` clicks, pushState, fetch SSR HTML, swap #app, hydrate.
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
 *   destroy?: (inst: object) => void,
 *   importPage?: (chunkId: string) => Promise<any>,
 * }} [opts]
 */
export function installClientNavigation(opts = {}) {
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    const win = typeof window !== 'undefined' ? window : null;
    const hist = opts.history || win?.history;
    const loc = opts.location || win?.location;
    const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!doc || !hist || !loc || !fetchImpl) {
        return { ok: false, reason: 'missing document/history/fetch' };
    }

    if (win && !win.__vmzBootId) {
        win.__vmzBootId = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    if (win) win.__vmzClientNavInstalled = true;

    /** @type {AbortController | null} */
    let inflight = null;
    let navigating = false;

    async function transitionTo(url, { replace = false, fromPop = false } = {}) {
        const target = new URL(url, loc.href);
        if (target.origin !== loc.origin) {
            loc.assign(target.href);
            return { ok: false, reason: 'cross-origin' };
        }

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
                // Fall back to full navigation on hard errors.
                if (!fromPop) loc.assign(target.href);
                return { ok: false, reason: `http ${res.status}` };
            }
            const html = await res.text();
            const nextApp = extractAppHtml(html, doc);
            if (!nextApp) {
                if (!fromPop) loc.assign(target.href);
                return { ok: false, reason: 'missing #app in response' };
            }

            const root = doc.getElementById('app');
            if (!root) {
                if (!fromPop) loc.assign(target.href);
                return { ok: false, reason: 'missing #app' };
            }

            // Dispose previous Direct instance if present.
            const prev = root.__vmzInst;
            if (prev && typeof opts.destroy === 'function') {
                opts.destroy(prev);
            } else if (prev && win?.vmzDestroy) {
                win.vmzDestroy(prev);
            }
            root.__vmzInst = null;

            root.outerHTML = nextApp.outerHTML;
            const fresh = doc.getElementById('app');
            if (!fresh) return { ok: false, reason: 'swap lost #app' };

            if (!fromPop) {
                if (replace) hist.replaceState({ vmzClientNav: true }, '', target.href);
                else hist.pushState({ vmzClientNav: true }, '', target.href);
            }

            const chunkId = fresh.getAttribute('data-vmz-page') || '';
            let props = {};
            try {
                const raw = fresh.getAttribute('data-vmz-props');
                if (raw) props = JSON.parse(raw);
            } catch {
                /* ignore */
            }

            if (chunkId) {
                const importChunk = opts.importPage || (async (id) => (await import(/* @vite-ignore */ `/${id}.client.js`)).default);
                const Page = await importChunk(chunkId);
                const layoutChain = (fresh.getAttribute('data-vmz-layout') || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                /** @type {any[]} */
                const layoutCtors = [];
                for (const id of layoutChain) {
                    layoutCtors.push(await importChunk(id));
                }
                const dom = await import(/* @vite-ignore */ '/vmz-dom.js');
                const hydrateRoute = opts.hydrateRoute || dom.hydrateRoute;
                if (typeof hydrateRoute === 'function') {
                    await hydrateRoute(Page, fresh, props, layoutCtors);
                } else {
                    const hydrate = opts.hydrate || dom.hydrate;
                    await hydrate(Page, fresh, props);
                }
            }

            if (win) {
                win.__vmzClientNavCount = (win.__vmzClientNavCount || 0) + 1;
                win.__vmzLastClientNav = {
                    href: target.pathname + target.search,
                    routeId: nextApp.getAttribute?.('data-vmz-route') || null,
                    chunkId,
                    bootId: win.__vmzBootId,
                };
            }
            return { ok: true, href: target.pathname + target.search, chunkId };
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
        void transitionTo(u.pathname + u.search + u.hash, {
            replace: a.getAttribute('data-vmz-replace') === 'true',
        });
    }

    function onPopState() {
        void transitionTo(loc.pathname + loc.search + loc.hash, { fromPop: true });
    }

    doc.addEventListener('click', onClick);
    win?.addEventListener?.('popstate', onPopState);

    return {
        ok: true,
        transitionTo,
        dispose() {
            doc.removeEventListener('click', onClick);
            win?.removeEventListener?.('popstate', onPopState);
        },
    };
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

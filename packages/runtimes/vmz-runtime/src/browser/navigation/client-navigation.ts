import { extractAppHtml } from './extract-html.js';
import { applyAppAttrs, canRetainLayouts, parseLayoutChain } from './layout-retain.js';
import { applyLocaleRealization, createLocaleTransition } from './locale-transition.js';
import { createScrollFocus } from './scroll-focus.js';

export function installClientNavigation(opts: Record<string, any> = {}) {
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    const win = typeof window !== 'undefined' ? window : null;
    const hist = opts.history || win?.history;
    const loc = opts.location || win?.location;
    const fetchImplDefault = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    let fetchImpl = fetchImplDefault;
    if (!doc || !hist || !loc || !fetchImpl) {
        return { ok: false, reason: 'missing document/history/fetch' };
    }

    if (win && !win.__vmzBootId) {
        win.__vmzBootId = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    if (win) win.__vmzClientNavInstalled = true;
    try {
        if (hist && 'scrollRestoration' in hist) hist.scrollRestoration = 'manual';
    } catch {
        /* ignore */
    }

    let inflight: AbortController | null = null;
    let navigating = false;

    const { saveScroll, restoreScroll, restoreFocus } = createScrollFocus({
        document: doc,
        window: win!,
        location: loc,
    });

    function destroyInst(inst: unknown) {
        if (!inst) return;
        if (typeof opts.destroy === 'function') opts.destroy(inst);
        else if (win?.vmzDestroy) win.vmzDestroy(inst);
    }

    async function loadDomFallback() {
        return import(/* @vite-ignore */ '/dom.browser.js' as string);
    }

    async function transitionTo(url: string | URL, { replace = false, fromPop = false, softFail = false }: Record<string, unknown> = {}) {
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
            let props: Record<string, unknown> = {};
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

            const importChunk = opts.importPage || (async (id: string) => (await import(/* @vite-ignore */ `/${id}.client.js`)).default);

            let liveRoot: HTMLElement = root;
            let retainedLayout = false;

            applyLocaleRealization(doc, nextApp);

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
                        const pageHost = (root as any).__vmzPageHost || root;
                        if (pageHost.__vmzInst) destroyInst(pageHost.__vmzInst);
                        await hydrate(Page, pageHost, props);
                        (root as any).__vmzPageHost = pageHost;
                        if (!(root as any).__vmzLayoutInsts?.length) (root as any).__vmzInst = pageHost.__vmzInst;
                    }
                }
                retainedLayout = true;
            } else {
                const prev = (root as any).__vmzInst;
                destroyInst(prev);
                (root as any).__vmzInst = null;
                (root as any).__vmzPageHost = null;
                (root as any).__vmzLayoutInsts = null;

                root.outerHTML = nextApp.outerHTML;
                const fresh = doc.getElementById('app');
                if (!fresh) return { ok: false, reason: 'swap lost #app' };
                liveRoot = fresh;

                if (chunkId) {
                    const Page = await importChunk(chunkId);

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

            const localeId = applyLocaleRealization(doc, liveRoot);
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
                    scrollMode: 'pending',
                    scrollY: null,
                };
            }

            if (win && typeof win.requestAnimationFrame === 'function') {
                await new Promise<void>((resolve) => {
                    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
                });
            }
            const scroll = await restoreScroll(target, Boolean(fromPop));
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

    const { transitionLocale, localizeClickHref } = createLocaleTransition({
        document: doc,
        window: win,
        location: loc,
        transitionTo,
    });

    function onClick(ev: MouseEvent) {
        if (navigating) return;
        if (ev.defaultPrevented) return;
        if (ev.button !== 0) return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        const a = (ev.target as Element | null)?.closest?.('a[data-vmz-route][href]') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
        const u = new URL(href, loc.href);
        if (u.origin !== loc.origin) return;
        if (a.hasAttribute('download') || a.getAttribute('target') === '_blank') return;

        ev.preventDefault();
        const realized = localizeClickHref(u.pathname + u.search + u.hash, a.getAttribute('data-vmz-route'));
        void transitionTo(realized, {
            replace: a.getAttribute('data-vmz-replace') === 'true',
        });
    }

    function onPopState() {
        void transitionTo(loc.pathname + loc.search + loc.hash, { fromPop: true });
    }

    if (win) {
        win.__vmzTransitionLocale = transitionLocale;
        win.__vmzClientNavSetFetch = (fn: unknown) => {
            fetchImpl = typeof fn === 'function' ? (fn as typeof fetch) : fetchImplDefault;
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

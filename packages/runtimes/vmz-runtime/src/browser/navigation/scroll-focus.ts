export type ScrollFocusEnv = {
    document: Document;
    window: Window;
    location: Location;
};

export function createScrollFocus({ document: doc, window: win, location: loc }: ScrollFocusEnv) {
    const scrollPositions = new Map<string, { x: number; y: number }>();

    function navKey(pathname: string, search: string) {
        return `${pathname || '/'}${search || ''}`;
    }

    function saveScroll() {
        scrollPositions.set(navKey(loc.pathname, loc.search), {
            x: win.scrollX || 0,
            y: win.scrollY || 0,
        });
    }

    async function restoreScroll(target: URL, fromPop: boolean) {
        const frame = () =>
            new Promise<void>((resolve) => {
                if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => resolve());
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
                for (let i = 0; i < 12; i++) {
                    apply();
                    const y = win.scrollY || 0;
                    if (Math.abs(y - saved.y) <= 2) break;
                    const docEl = doc.documentElement || doc.body;
                    const maxY = Math.max(0, (docEl?.scrollHeight || 0) - (win.innerHeight || 0));
                    if (maxY + 2 < saved.y) {
                        await frame();
                        continue;
                    }
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

    function restoreFocus(root: HTMLElement | null, target: URL) {
        if (!root || !doc) return null;
        let el: HTMLElement | null = null;
        if (target.hash) {
            const id = decodeURIComponent(target.hash.slice(1));
            el = id ? doc.getElementById(id) : null;
        }
        if (!el) el = root.querySelector('[data-vmz-focus]');
        if (!el) el = root.querySelector('main, h1, [role="main"]');
        if (!el) el = root;
        if (el === doc.body) return null;
        const focusable = el as HTMLElement;
        if (!focusable.hasAttribute('tabindex') && focusable.tabIndex < 0) {
            focusable.setAttribute('tabindex', '-1');
        }
        try {
            focusable.focus({ preventScroll: true });
        } catch {
            /* ignore */
        }
        return focusable.getAttribute('data-vmz-focus') || focusable.tagName?.toLowerCase() || null;
    }

    return { saveScroll, restoreScroll, restoreFocus };
}

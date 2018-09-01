/** Shared homepage locale helpers for #locales message refresh after LocaleTransition. */

export type LocaleId = 'zh-hans' | 'en-us' | string;

export function readLocaleId(preferred?: string | null): LocaleId {
    if (preferred) return preferred;
    if (typeof document !== 'undefined') {
        return document.documentElement.getAttribute('data-locale') || 'zh-hans';
    }
    return 'zh-hans';
}

export function docsPaths(localeId: LocaleId) {
    const loc = localeId === 'en-us' ? 'en-us' : 'zh-hans';
    return {
        docsRootHref: `/d/${loc}/`,
        guideHref: `/d/${loc}/guide/`,
        deployDocHref: `/d/${loc}/guide/deploy/`,
        pluginsHref: `/d/${loc}/plugins/`,
    };
}

/** Run fn while message modules resolve preferred LocaleId via __vmzLocaleIdHint. */
export function withLocaleHint<T>(localeId: LocaleId, fn: () => T): T {
    const g = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
    const prev = g ? g.__vmzLocaleIdHint : undefined;
    if (g) g.__vmzLocaleIdHint = localeId;
    try {
        return fn();
    } finally {
        if (g) {
            if (prev === undefined) delete g.__vmzLocaleIdHint;
            else g.__vmzLocaleIdHint = prev;
        }
    }
}

/** Observe html[data-locale] so soft-nav LocaleTransition refreshes sibling chrome. */
export function watchDocumentLocale(onChange: (localeId: string) => void): () => void {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
        return () => {};
    }
    const el = document.documentElement;
    let last = el.getAttribute('data-locale') || '';
    const obs = new MutationObserver(() => {
        const next = el.getAttribute('data-locale') || '';
        if (next === last) return;
        last = next;
        if (next) onChange(next);
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-locale'] });
    return () => obs.disconnect();
}

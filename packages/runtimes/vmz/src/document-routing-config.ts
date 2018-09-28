// @ts-nocheck
/**
 * Project locale routing — consume Rust LocalePlan (no author JSON5 in TS).
 */

import { loadLocalePlan } from './author-input.js';

/**
 * @param {string} projectRoot
 * @returns {{ strategy?: string, defaultPrefix?: string, defaultLocale?: string } | null}
 */
export function loadLocalesRouting(projectRoot) {
    const plan = loadLocalePlan(projectRoot);
    if (!plan || plan.diagnostics?.some((d) => d.code === 'vmz::locale::manifest_missing')) {
        return null;
    }
    const routing = plan.routing || {};
    return {
        strategy: routing.strategy || 'prefix',
        defaultPrefix: routing.defaultPrefix || 'include',
        defaultLocale: plan.defaultLocale || undefined,
    };
}

/**
 * @param {string} routeBase
 * @param {string} pageKey
 */
export function docsRouteNone(routeBase, pageKey) {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const parts = [base.replace(/^\//, ''), key].filter((p) => p !== '');
    return `/${parts.length ? parts.join('/') : ''}`;
}

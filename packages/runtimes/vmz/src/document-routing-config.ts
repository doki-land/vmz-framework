/**
 * Project locale routing — consume Rust LocalePlan (no author JSON5 in TS).
 */

import { loadLocalePlan } from './author-input.js';

export interface LocalesRouting {
    strategy?: string;
    defaultPrefix?: string;
    defaultLocale?: string;
}

export function loadLocalesRouting(projectRoot: string): LocalesRouting | null {
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

export function docsRouteNone(routeBase: string, pageKey: string): string {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const parts = [base.replace(/^\//, ''), key].filter((p) => p !== '');
    return `/${parts.length ? parts.join('/') : ''}`;
}

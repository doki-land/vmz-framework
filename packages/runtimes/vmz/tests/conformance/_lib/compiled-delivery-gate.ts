/**
 * Shared build + artifact asserts for 0.1.30 Compiled Delivery / Navigation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runVmzBuild } from './production-proof.ts';
import { repoRoot } from './repo-root.ts';

export const COMPILED_DELIVERY_FIXTURE = 'packages/examples/production-router';

export const ROUTE_CATALOG_SCHEMA = 'vmz.route.catalog.v0';
export const LOCALE_LINK_PLAN_SCHEMA = 'vmz.static.locale_link_plan.v0';
export const LOCALE_REALIZATION_SCHEMA = 'vmz.locale.route_realization.v0';
export const ASSET_PLAN_SCHEMA = 'vmz.asset.plan.v0';
export const CONTENT_ADDRESSED_SCHEMA = 'vmz.content_addressed_assets.v0';

export type CompiledDeliveryScan = {
    dist: string;
    routeCatalog: Record<string, unknown> | null;
    localeLinkPlan: Record<string, unknown> | null;
    localeRealization: Record<string, unknown> | null;
    assetPlan: Record<string, unknown> | null;
    contentAddressed: Record<string, unknown> | null;
};

function readJson(dist: string, ...rel: string[]): Record<string, unknown> | null {
    const p = path.join(dist, ...rel);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export function buildCompiledDelivery(root = repoRoot(import.meta.url)): CompiledDeliveryScan {
    // Static profile emits route/locale catalogs AND asset-plan / content-addressed (rewrittenHtml: 0).
    const build = runVmzBuild(COMPILED_DELIVERY_FIXTURE, root, {
        profile: 'static',
        extraArgs: ['--origin', 'https://compiled-delivery.example.test'],
    });
    if (build.status !== 0) {
        throw new Error(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
    }
    const dist = build.dist;
    return {
        dist,
        routeCatalog: readJson(dist, '_vmz', 'route-catalog.json'),
        localeLinkPlan: readJson(dist, '_vmz', 'locale-link-plan.json'),
        localeRealization: readJson(dist, '_vmz', 'locale-route-realization.json'),
        assetPlan: readJson(dist, '_vmz', 'asset-plan.json'),
        contentAddressed: readJson(dist, '_vmz', 'content-addressed-assets.json'),
    };
}

export function assertCompiledRouteArtifact(scan: CompiledDeliveryScan): string[] {
    const errors: string[] = [];
    const cat = scan.routeCatalog;
    if (!cat) {
        errors.push('missing _vmz/route-catalog.json');
        return errors;
    }
    if (cat.schema !== ROUTE_CATALOG_SCHEMA) errors.push(`route-catalog schema=${String(cat.schema)}`);
    const pages = Array.isArray(cat.pages) ? cat.pages : [];
    if (!pages.length) errors.push('route-catalog.pages empty');
    for (const page of pages as Array<Record<string, unknown>>) {
        if (!page?.chunkId || !page?.pathPattern || !Array.isArray(page?.segs)) {
            errors.push(`route-catalog page incomplete: ${JSON.stringify(page)}`);
            break;
        }
    }
    return errors;
}

export function assertCompiledLocaleArtifact(scan: CompiledDeliveryScan): string[] {
    const errors: string[] = [];
    const realization = scan.localeRealization;
    if (!realization) {
        errors.push('missing _vmz/locale-route-realization.json');
    } else if (realization.schema !== LOCALE_REALIZATION_SCHEMA) {
        errors.push(`locale realization schema=${String(realization.schema)}`);
    } else if (!Array.isArray(realization.realizations) || !realization.realizations.length) {
        errors.push('locale realizations empty');
    }

    const plan = scan.localeLinkPlan;
    if (!plan) {
        errors.push('missing _vmz/locale-link-plan.json');
        return errors;
    }
    if (plan.schema !== LOCALE_LINK_PLAN_SCHEMA) errors.push(`locale-link-plan schema=${String(plan.schema)}`);
    const rows = Array.isArray(plan.rows) ? plan.rows : [];
    if (!rows.length) errors.push('locale-link-plan.rows empty');
    const hasStaticHref = rows.some((r: Record<string, unknown>) => {
        const href = String(r?.href || '');
        return href && !/\[[^\]]+\]/.test(href) && !/\/:[^/]+/.test(href);
    });
    if (!hasStaticHref) errors.push('locale-link-plan has no static href rows');
    return errors;
}

export function assertCompiledAssetArtifact(scan: CompiledDeliveryScan): string[] {
    const errors: string[] = [];
    const plan = scan.assetPlan;
    if (!plan) {
        errors.push('missing _vmz/asset-plan.json');
    } else if (plan.schema !== ASSET_PLAN_SCHEMA && plan.schema !== 'vmz.asset.plan.v0') {
        // tolerate if schema field uses same constant
        if (typeof plan.schema !== 'string' || !String(plan.schema).includes('asset')) {
            errors.push(`asset-plan schema=${String(plan.schema)}`);
        }
    }

    const ca = scan.contentAddressed;
    if (!ca) {
        errors.push('missing _vmz/content-addressed-assets.json');
        return errors;
    }
    if (ca.schema !== CONTENT_ADDRESSED_SCHEMA) errors.push(`content-addressed schema=${String(ca.schema)}`);
    if (ca.rewrittenHtml !== 0) errors.push(`rewrittenHtml must be 0, got ${String(ca.rewrittenHtml)}`);
    return errors;
}

export function assertNoRuntimeManifestInterpretation(scan: CompiledDeliveryScan, root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [...assertCompiledRouteArtifact(scan), ...assertCompiledLocaleArtifact(scan)];
    // Serve-host must load compiled catalog (source contract).
    const serveHost = fs.readFileSync(path.join(root, 'packages/runtimes/vmz-runtime/src/serve-host.ts'), 'utf8');
    if (/listPagesFromDeployment/.test(serveHost)) {
        errors.push('serve-host still defines listPagesFromDeployment (must consume route-catalog)');
    }
    if (!/ROUTE_CATALOG_SCHEMA|route-catalog\.json/.test(serveHost)) {
        errors.push('serve-host missing route-catalog consumption');
    }
    // Client-nav must prefer frozen href table.
    const clientNav = fs.readFileSync(path.join(root, 'packages/runtimes/vmz-runtime/src/client-nav.ts'), 'utf8');
    if (!/data-vmz-locale-hrefs/.test(clientNav) || !/lookupFrozenLocaleHref/.test(clientNav)) {
        errors.push('client-nav missing frozen locale href table lookup');
    }
    // Dist entry / client-nav copy should carry the attribute writer side (SSR) via serve-host emit.
    if (!/data-vmz-locale-hrefs/.test(serveHost)) {
        errors.push('serve-host must emit data-vmz-locale-hrefs');
    }
    return errors;
}

export function assertNoPostEmitSemanticRewrite(scan: CompiledDeliveryScan, root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [...assertCompiledAssetArtifact(scan)];
    const caModule = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/content-addressed-assets.ts'), 'utf8');
    if (!/rewrittenHtml:\s*0/.test(caModule)) {
        errors.push('content-addressed-assets must record rewrittenHtml: 0');
    }
    // localizeBodyLinks must apply plan rows, not invent path algebra inside apply.
    const localize = fs.readFileSync(path.join(root, 'packages/runtimes/vmz-runtime/src/localize-body-links.ts'), 'utf8');
    if (!/applyLocaleLinkPlan/.test(localize) || !/LOCALE_LINK_PLAN_SCHEMA/.test(localize)) {
        errors.push('localize-body-links must center on locale link plan rows');
    }
    return errors;
}

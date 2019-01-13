/**
 * Emit RouteId × LocaleId realization (+ PageMeta / hreflang seed) into dist/_vmz.
 * Consumed by serve-host + static-emit; LocaleId stays out of stable RouteId.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildLocaleLinkPlan, LOCALE_LINK_PLAN_SCHEMA, linkRouteAliasesFromUnits } from '@vmz/core/localize-body-links';
import { checkLocales, localeHasErrors } from './locale-check.js';
import { buildLocalePageMeta, buildLocaleRouteRealizationTable } from './locale-router.js';
import { writePrettyJsonFile } from './pretty-json.js';
import { listPublicPageUnits, unitBrowserPathPattern } from './route-path.js';

export const LOCALE_ROUTE_REALIZATION_ARTIFACT_SCHEMA = 'vmz.locale.route_realization.v0';
export const LOCALE_LINK_PLAN_REL = '_vmz/locale-link-plan.json';
export { LOCALE_LINK_PLAN_SCHEMA };

export interface EmitLocaleRouteRealizationOpts {
    origin?: string;
}

export function emitLocaleRouteRealization(projectRoot: string, distDir: string, opts: EmitLocaleRouteRealizationOpts = {}) {
    const report = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(report)) {
        return { ok: false, written: [], diagnostics: report.diagnostics || [], artifact: null };
    }
    // Missing /locales is warning (not error) — still never silent; no realization artifact yet.
    if (!report.manifest) {
        return { ok: true, written: [], artifact: null, diagnostics: report.diagnostics || [] };
    }

    const deploymentPath = path.join(distDir, 'vmz-deployment.json');
    if (!fs.existsSync(deploymentPath)) {
        return {
            ok: false,
            written: [],
            diagnostics: [{ severity: 'error', code: 'locale.route.missing_deployment', message: 'missing vmz-deployment.json' }],
            artifact: null,
        };
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const pages = listPublicPageUnits(deployment);
    const routes = pages.map((u) => ({
        routeId: String(u.chunkId),
        path: unitBrowserPathPattern(u),
    }));

    const localeEntries = report.manifest?.locales || [];
    const locales = localeEntries.map((l) => l.id);
    const directions = Object.fromEntries(localeEntries.map((l) => [l.id, l.direction || 'ltr']));
    const defaultLocale = report.manifest?.defaultLocale;
    const routing = report.manifest?.routing || { strategy: 'prefix', defaultPrefix: 'include' };

    const table = buildLocaleRouteRealizationTable({
        routes,
        locales,
        defaultLocale,
        routing,
    });
    if (table.status === 'failed') {
        return { ok: false, written: [], diagnostics: table.diagnostics || [], artifact: null };
    }

    const origin = String(opts.origin || process.env.VMZ_SITE_ORIGIN || 'https://example.test').replace(/\/$/, '');
    const pageMetas: ReturnType<typeof buildLocalePageMeta>[] = [];
    for (const route of routes) {
        for (const loc of locales) {
            const meta = buildLocalePageMeta({
                routeId: route.routeId,
                localeId: loc,
                direction: directions[loc],
                title: route.routeId,
                origin,
                realizations: table.realizations,
                locales,
                defaultLocale,
            });
            pageMetas.push(meta);
        }
    }

    const artifact = {
        schema: LOCALE_ROUTE_REALIZATION_ARTIFACT_SCHEMA,
        defaultLocale,
        locales: localeEntries.map((l) => ({
            id: l.id,
            label: l.label || l.id,
            direction: l.direction || 'ltr',
        })),
        routing: {
            strategy: routing.strategy || 'prefix',
            defaultPrefix: routing.defaultPrefix || 'include',
            defaultLocale,
        },
        origin,
        routes,
        realizations: table.realizations,
        pageMetas,
        linkRouteAliases: linkRouteAliasesFromUnits(pages),
    };

    const vmzDir = path.join(distDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    const outPath = path.join(vmzDir, 'locale-route-realization.json');
    writePrettyJsonFile(outPath, artifact);

    const manifestOut = path.join(vmzDir, 'locale-manifest.json');
    writePrettyJsonFile(manifestOut, {
        schema: 'vmz.locale.manifest.v0',
        defaultLocale,
        locales: artifact.locales,
        routing: artifact.routing,
    });

    const linkPlan = buildLocaleLinkPlan(artifact);
    writePrettyJsonFile(path.join(distDir, ...LOCALE_LINK_PLAN_REL.split('/')), {
        schema: LOCALE_LINK_PLAN_SCHEMA,
        rows: linkPlan.rows,
    });

    return {
        ok: true,
        written: ['_vmz/locale-route-realization.json', '_vmz/locale-manifest.json', LOCALE_LINK_PLAN_REL],
        artifact,
        diagnostics: [],
    };
}

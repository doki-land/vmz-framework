/**
 * Build DocumentManifest + run / --strict checks.
 *
 * Author documents config is parsed by Rust DocumentRoutePlan; TS only
 * merges filesystem scan (pageKeys) and coverage diagnostics.
 */

import path from 'node:path';
import { loadDocumentRoutePlan, mapPlanDiagnostics, type DocumentRoutePlan } from './author-input.js';
import { scanDocumentsTree } from './document-scan.js';
import {
    DIAG,
    DOCUMENT_MANIFEST_SCHEMA,
    type DocumentCollection,
    type DocumentDiagnostic,
    type DocumentManifest,
    type DocumentMount,
    type PageRecord,
} from './document-schema.js';

export interface DocumentsConfigShape {
    defaultLocale?: string;
    locales: Record<string, { label: unknown }>;
    collections: Record<string, { source: string; mount: string }>;
    fallback?: boolean;
}

export interface LoadDocumentsConfigResult {
    config: DocumentsConfigShape | null;
    diagnostics: DocumentDiagnostic[];
    configPath: string | null;
    plan: DocumentRoutePlan;
}

export interface CheckDocumentsOpts {
    projectRoot: string;
    strict?: boolean;
}

/** Resolve project documents root. */
export function resolveDocumentsRoot(projectRoot: string): string {
    return path.resolve(projectRoot, 'documents');
}

/** Load normalized DocumentRoutePlan from Rust (author JSON5/JSON/declaration). */
export function loadDocumentsRoutePlan(projectRoot: string): DocumentRoutePlan {
    return loadDocumentRoutePlan(projectRoot);
}

/**
 * @deprecated Prefer loadDocumentsRoutePlan(projectRoot). Kept for call sites that
 * only need the plan-shaped config fields.
 */
export function loadDocumentsConfig(documentsRoot: string): LoadDocumentsConfigResult {
    const projectRoot = path.dirname(documentsRoot);
    const plan = loadDocumentRoutePlan(projectRoot);
    const diagnostics = toDocumentDiagnostics(mapPlanDiagnostics(plan.diagnostics));
    const configPath = plan.sourcePath ? path.join(projectRoot, plan.sourcePath) : null;
    const missing = diagnostics.some((d) => d.code === DIAG.CONFIG_MISSING);
    if (missing) {
        return { config: null, diagnostics, configPath, plan };
    }
    const config: DocumentsConfigShape = {
        defaultLocale: plan.defaultLocale ?? undefined,
        locales: Object.fromEntries(Object.entries(plan.localeLabels || {}).map(([id, label]) => [id, { label }])),
        collections: Object.fromEntries(
            (plan.collections || []).map((c) => [c.id, { source: c.sourceRoot || '.', mount: c.routeBase || '/docs' }]),
        ),
    };
    if (plan.silentFallbackRequested) {
        config.fallback = true;
    }
    return { config, diagnostics, configPath, plan };
}

export function checkDocuments(opts: CheckDocumentsOpts): DocumentManifest {
    const projectRoot = path.resolve(opts.projectRoot);
    const documentsRoot = resolveDocumentsRoot(projectRoot);
    const strict = Boolean(opts.strict);

    const diagnostics: DocumentDiagnostic[] = [];

    const scanned = scanDocumentsTree(documentsRoot);
    diagnostics.push(...scanned.diagnostics);

    const plan = loadDocumentRoutePlan(projectRoot);
    diagnostics.push(...toDocumentDiagnostics(mapPlanDiagnostics(plan.diagnostics)));

    const configMissing = (plan.diagnostics || []).some((d) => d.code === DIAG.CONFIG_MISSING);
    const configPath = plan.sourcePath ? path.join(projectRoot, plan.sourcePath) : null;

    if (configMissing && strict) {
        // Plan already emitted warning; elevate message under --strict if needed.
        if (!diagnostics.some((d) => d.code === DIAG.CONFIG_MISSING && d.severity === 'error')) {
            diagnostics.push({
                code: DIAG.CONFIG_MISSING,
                severity: 'error',
                message: 'documents.config.json|json5|ts|js missing; strict mode requires defaultLocale + locales for strict coverage checks',
                path: documentsRoot,
            });
        }
    }

    const localeLabels: Record<string, string> = { ...(plan.localeLabels || {}) };
    const defaultLocale = plan.defaultLocale || null;
    const collections: DocumentCollection[] = [];
    const mounts: DocumentMount[] = [];

    for (const c of plan.collections || []) {
        const sourceRoot = c.sourceRoot || '.';
        const routeBase = c.routeBase || '/docs';
        const pageKeys = [
            ...new Set(
                scanned.pages
                    .filter((p) => {
                        if (sourceRoot === '.' || sourceRoot === './') return true;
                        const prefix = sourceRoot.replace(/^\.\//, '').replace(/\/$/, '');
                        return p.identity.pageKey === prefix || p.identity.pageKey.startsWith(`${prefix}/`);
                    })
                    .map((p) => p.identity.pageKey),
            ),
        ].sort();
        collections.push({ id: c.id, sourceRoot, pageKeys });
        mounts.push({
            collectionId: c.id,
            routeBase,
            mode: routeBase === '/' ? 'standalone' : 'integrated',
        });
    }

    if (collections.length === 0) {
        const pageKeys = [...new Set(scanned.pages.map((p) => p.identity.pageKey))].sort();
        collections.push({ id: 'default', sourceRoot: '.', pageKeys });
        mounts.push({ collectionId: 'default', routeBase: '/docs', mode: 'integrated' });
    }

    const diskLocales = new Set(scanned.locales);
    const configLocales = Object.keys(localeLabels);
    if (defaultLocale) {
        if (!diskLocales.has(defaultLocale)) {
            diagnostics.push({
                code: DIAG.LOCALE_MISSING_DEFAULT,
                severity: 'error',
                message: `defaultLocale ${JSON.stringify(defaultLocale)} has no directory under documents/`,
                path: configPath || documentsRoot,
            });
        }
        if (configLocales.length && !configLocales.includes(defaultLocale)) {
            diagnostics.push({
                code: DIAG.CONFIG_DEFAULT_LOCALE,
                severity: 'error',
                message: `defaultLocale ${JSON.stringify(defaultLocale)} not listed in config.locales`,
                path: configPath || documentsRoot,
            });
        }
    } else if (strict) {
        diagnostics.push({
            code: DIAG.CONFIG_DEFAULT_LOCALE,
            severity: 'error',
            message: 'defaultLocale is required under --strict',
            path: configPath || documentsRoot,
        });
    }

    for (const loc of configLocales) {
        if (!diskLocales.has(loc)) {
            diagnostics.push({
                code: DIAG.LOCALE_MISSING_DEFAULT,
                severity: 'error',
                message: `config.locales entry ${JSON.stringify(loc)} has no documents/${loc}/ directory`,
                path: configPath || documentsRoot,
            });
        }
    }

    // Coverage: default locale PageKeys are baseline; other locales missing/orphan under --strict
    if (defaultLocale && diskLocales.has(defaultLocale)) {
        const byLocale = new Map<string, Set<string>>();
        for (const p of scanned.pages) {
            const set = byLocale.get(p.identity.locale) || new Set<string>();
            set.add(p.identity.pageKey);
            byLocale.set(p.identity.locale, set);
        }
        const baseline = byLocale.get(defaultLocale) || new Set<string>();
        for (const loc of scanned.locales) {
            if (loc === defaultLocale) continue;
            const keys = byLocale.get(loc) || new Set<string>();
            for (const pk of baseline) {
                if (!keys.has(pk)) {
                    diagnostics.push({
                        code: DIAG.LOCALE_MISSING_PAGE,
                        severity: strict ? 'error' : 'warning',
                        message: `missing translation: locale ${loc} lacks PageKey ${JSON.stringify(pk)} (present in ${defaultLocale})`,
                        path: `documents/${loc}`,
                    });
                }
            }
            for (const pk of keys) {
                if (!baseline.has(pk)) {
                    diagnostics.push({
                        code: DIAG.LOCALE_ORPHAN_PAGE,
                        severity: strict ? 'error' : 'warning',
                        message: `orphan page: locale ${loc} has PageKey ${JSON.stringify(pk)} missing from defaultLocale ${defaultLocale}`,
                        path: `documents/${loc}/${pk}.md`,
                    });
                }
            }
        }
    }

    const pages: PageRecord[] = scanned.pages.map((p) => ({
        identity: p.identity,
        sourcePath: p.sourcePath,
        route: null,
        anchors: [],
    }));

    return {
        schema: DOCUMENT_MANIFEST_SCHEMA,
        root: documentsRoot,
        defaultLocale,
        locales: scanned.locales,
        localeLabels,
        collections,
        mounts,
        pages,
        diagnostics,
    };
}

export function manifestHasErrors(manifest: DocumentManifest): boolean {
    return (manifest.diagnostics || []).some((d) => d.severity === 'error');
}

function toDocumentDiagnostics(
    rows: Array<{ code: string; severity: string; message: string; path: string | undefined }>,
): DocumentDiagnostic[] {
    return rows.map((d) => ({
        code: d.code,
        severity: d.severity === 'warning' || d.severity === 'advice' ? 'warning' : 'error',
        message: d.message,
        path: d.path,
    }));
}

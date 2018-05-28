// @ts-nocheck
/**
 * Build DocumentManifest + run D0 / --strict checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIAG, DOCUMENT_MANIFEST_SCHEMA } from './document-schema.js';
import { scanDocumentsTree } from './document-scan.js';

/**
 * Resolve project documents root.
 * @param {string} projectRoot
 */
export function resolveDocumentsRoot(projectRoot) {
    return path.resolve(projectRoot, 'documents');
}

/**
 * Parse documents.config.json or a JSON-compatible export-default .ts/.js.
 * @param {string} documentsRoot
 * @returns {{ config: Record<string, any> | null, diagnostics: any[], configPath: string | null }}
 */
export function loadDocumentsConfig(documentsRoot) {
    /** @type {any[]} */
    const diagnostics = [];
    const candidates = ['documents.config.json', 'documents.config.ts', 'documents.config.js'];
    for (const name of candidates) {
        const p = path.join(documentsRoot, name);
        if (!fs.existsSync(p)) continue;
        try {
            const raw = fs.readFileSync(p, 'utf8');
            const config = parseConfigSource(raw, name);
            return { config, diagnostics, configPath: p };
        } catch (e) {
            diagnostics.push({
                code: DIAG.CONFIG_INVALID,
                severity: 'error',
                message: `failed to parse ${name}: ${e instanceof Error ? e.message : String(e)}`,
                path: p,
            });
            return { config: null, diagnostics, configPath: p };
        }
    }
    return { config: null, diagnostics, configPath: null };
}

/**
 * D0: only declaration objects — no arbitrary hooks.
 * @param {string} raw
 * @param {string} filename
 */
function parseConfigSource(raw, filename) {
    if (filename.endsWith('.json')) {
        return JSON.parse(raw);
    }
    // Strip line/block comments, then require `export default { ... }`
    let s = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    s = s.trim();
    const m = s.match(/^export\s+default\s+([\s\S]*?);?\s*$/);
    if (!m) {
        throw new Error('expected `export default { ... }` (JSON-compatible declaration only)');
    }
    let body = m[1].trim();
    // Quote bare keys: { defaultLocale: "x" } → { "defaultLocale": "x" }
    body = body.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    // Single-quoted strings → JSON double-quoted
    body = body.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) =>
        JSON.stringify(inner.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')),
    );
    // Trailing commas
    body = body.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(body);
}

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {boolean} [opts.strict]
 * @returns {import('./document-schema.js').DocumentManifest}
 */
export function checkDocuments(opts) {
    const projectRoot = path.resolve(opts.projectRoot);
    const documentsRoot = resolveDocumentsRoot(projectRoot);
    const strict = Boolean(opts.strict);

    /** @type {import('./document-schema.js').DocumentDiagnostic[]} */
    const diagnostics = [];

    const scanned = scanDocumentsTree(documentsRoot);
    diagnostics.push(...scanned.diagnostics);

    const { config, diagnostics: cfgDiags, configPath } = loadDocumentsConfig(documentsRoot);
    diagnostics.push(...cfgDiags);

    if (!config) {
        diagnostics.push({
            code: DIAG.CONFIG_MISSING,
            severity: strict ? 'error' : 'warning',
            message: 'documents.config.json|ts missing; D0 requires defaultLocale + locales for strict coverage checks',
            path: documentsRoot,
        });
    }

    /** @type {Record<string, string>} */
    const localeLabels = {};
    let defaultLocale = null;
    /** @type {import('./document-schema.js').DocumentCollection[]} */
    const collections = [];
    /** @type {import('./document-schema.js').DocumentMount[]} */
    const mounts = [];

    if (config && typeof config === 'object') {
        if (typeof config.defaultLocale === 'string') {
            defaultLocale = config.defaultLocale;
        }
        if (config.locales && typeof config.locales === 'object') {
            for (const [k, v] of Object.entries(config.locales)) {
                localeLabels[k] = v && typeof v === 'object' && typeof v.label === 'string' ? v.label : k;
            }
        }
        if (config.collections && typeof config.collections === 'object') {
            for (const [id, c] of Object.entries(config.collections)) {
                const sourceRoot = c && typeof c === 'object' && typeof c.source === 'string' ? c.source : '.';
                const routeBase = c && typeof c === 'object' && typeof c.mount === 'string' ? c.mount : '/docs';
                const pageKeys = [
                    ...new Set(
                        scanned.pages
                            .filter((p) => {
                                if (sourceRoot === '.' || sourceRoot === './') return true;
                                const prefix = sourceRoot.replace(/^\.\//, '').replace(/\/$/, '');
                                return p.identity.pageKey === prefix || p.identity.pageKey.startsWith(prefix + '/');
                            })
                            .map((p) => p.identity.pageKey),
                    ),
                ].sort();
                collections.push({ id, sourceRoot, pageKeys });
                mounts.push({
                    collectionId: id,
                    routeBase,
                    mode: routeBase === '/' ? 'standalone' : 'integrated',
                });
            }
        }
    }

    if (collections.length === 0) {
        const pageKeys = [...new Set(scanned.pages.map((p) => p.identity.pageKey))].sort();
        collections.push({ id: 'default', sourceRoot: '.', pageKeys });
        mounts.push({ collectionId: 'default', routeBase: '/docs', mode: 'integrated' });
    }

    // Config locales vs disk
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

    // D0: no silent whole-page fallback by default
    if (config && config.fallback === true) {
        diagnostics.push({
            code: DIAG.FALLBACK_SILENT,
            severity: 'error',
            message: 'silent whole-page fallback is forbidden; allow only explicit nav/metadata or per-page fallback',
            path: configPath || documentsRoot,
        });
    }

    // Coverage: default locale PageKeys are baseline; other locales missing/orphan under --strict
    if (defaultLocale && diskLocales.has(defaultLocale)) {
        const byLocale = new Map();
        for (const p of scanned.pages) {
            const set = byLocale.get(p.identity.locale) || new Set();
            set.add(p.identity.pageKey);
            byLocale.set(p.identity.locale, set);
        }
        const baseline = byLocale.get(defaultLocale) || new Set();
        for (const loc of scanned.locales) {
            if (loc === defaultLocale) continue;
            const keys = byLocale.get(loc) || new Set();
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

    /** @type {import('./document-schema.js').PageRecord[]} */
    const pages = scanned.pages.map((p) => ({
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

/**
 * @param {import('./document-schema.js').DocumentManifest} manifest
 */
export function manifestHasErrors(manifest) {
    return (manifest.diagnostics || []).some((d) => d.severity === 'error');
}

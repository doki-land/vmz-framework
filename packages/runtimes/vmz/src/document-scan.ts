// @ts-nocheck
/**
 * Scan /documents tree → pages + locale dirs .
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIAG, DOCUMENT_RESERVED_TOP } from './document-schema.js';
import { canonicalLocale, softNormalizeLocale, validateLocaleLiteral } from './document-locale.js';

/**
 * @param {string} dir
 * @param {(rel: string) => void} visit
 * @param {string} [prefix]
 */
function walkMd(dir, visit, prefix = '') {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walkMd(full, visit, rel);
        } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
            visit(rel.replace(/\\/g, '/'));
        }
    }
}

/**
 * PageKey from locale-relative markdown path (strip extension; index → parent or "index").
 * @param {string} relMd e.g. guide/install.md | index.md | guide/index.md
 */
export function pageKeyFromRel(relMd) {
    const norm = relMd.replace(/\\/g, '/').replace(/^\.\//, '');
    let withoutExt = norm.replace(/\.md$/i, '');
    if (withoutExt.endsWith('/index')) {
        withoutExt = withoutExt.slice(0, -'/index'.length);
    } else if (withoutExt === 'index') {
        withoutExt = 'index';
    }
    return withoutExt.replace(/^\/+|\/+$/g, '') || 'index';
}

/**
 * @param {string} documentsRoot absolute path to .../documents
 * @returns {{
 * locales: string[],
 * pages: Array<{ identity: { pageKey: string, locale: string }, sourcePath: string }>,
 * diagnostics: Array<{ code: string, severity: string, message: string, path?: string }>,
 * }}
 */
export function scanDocumentsTree(documentsRoot) {
    /** @type {Array<{ code: string, severity: string, message: string, path?: string }>} */
    const diagnostics = [];
    /** @type {string[]} */
    const locales = [];
    /** @type {Array<{ identity: { pageKey: string, locale: string }, sourcePath: string }>} */
    const pages = [];

    if (!fs.existsSync(documentsRoot) || !fs.statSync(documentsRoot).isDirectory()) {
        diagnostics.push({
            code: DIAG.LAYOUT_MISSING_DOCUMENTS,
            severity: 'error',
            message: `documents root missing: ${documentsRoot}`,
            path: documentsRoot,
        });
        return { locales, pages, diagnostics };
    }

    /** @type {Map<string, string[]>} canonical → literals */
    const byCanonical = new Map();

    const top = fs.readdirSync(documentsRoot, { withFileTypes: true });
    for (const ent of top) {
        if (ent.name.startsWith('.')) continue;
        const full = path.join(documentsRoot, ent.name);
        if (DOCUMENT_RESERVED_TOP.has(ent.name)) continue;

        if (ent.isFile()) {
            diagnostics.push({
                code: DIAG.LAYOUT_ILLEGAL_TOP,
                severity: 'error',
                message: `illegal top-level file under documents/ (only package.json, documents.config.*, public/ reserved): ${ent.name}`,
                path: full,
            });
            continue;
        }

        if (!ent.isDirectory()) continue;

        const v = validateLocaleLiteral(ent.name);
        if (!v.ok) {
            diagnostics.push({
                code: v.code,
                severity: 'error',
                message: v.message,
                path: full,
            });
            // Still try to detect alias conflicts with soft form
            const soft = softNormalizeLocale(ent.name);
            const can = canonicalLocale(soft);
            const list = byCanonical.get(can) || [];
            list.push(ent.name);
            byCanonical.set(can, list);
            continue;
        }

        const list = byCanonical.get(v.canonical) || [];
        list.push(ent.name);
        byCanonical.set(v.canonical, list);
        locales.push(ent.name);

        const seenKeys = new Set();
        walkMd(full, (relMd) => {
            const pageKey = pageKeyFromRel(relMd);
            const sourcePath = path.join(ent.name, relMd).replace(/\\/g, '/');
            if (seenKeys.has(pageKey)) {
                diagnostics.push({
                    code: DIAG.PAGE_DUPLICATE,
                    severity: 'error',
                    message: `duplicate PageKey ${JSON.stringify(pageKey)} under locale ${ent.name}`,
                    path: sourcePath,
                });
                return;
            }
            seenKeys.add(pageKey);
            pages.push({
                identity: { pageKey, locale: ent.name },
                sourcePath,
            });
        });
    }

    for (const [canonical, literals] of byCanonical) {
        const uniq = [...new Set(literals)];
        if (uniq.length > 1) {
            diagnostics.push({
                code: DIAG.LOCALE_CONFLICT,
                severity: 'error',
                message: `locale identity conflict for canonical ${JSON.stringify(canonical)}: directories ${uniq.map((s) => JSON.stringify(s)).join(', ')} must not coexist`,
                path: documentsRoot,
            });
        }
    }

    locales.sort();
    pages.sort((a, b) => {
        const c = a.identity.locale.localeCompare(b.identity.locale);
        return c !== 0 ? c : a.identity.pageKey.localeCompare(b.identity.pageKey);
    });

    return { locales, pages, diagnostics };
}

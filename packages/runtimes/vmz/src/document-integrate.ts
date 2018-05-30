// @ts-nocheck
/**
 * Integrated DocumentMount — build /documents into the host app dist so
 * routeBase (e.g. /d) is served as static HTML next to SSR pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildDocuments } from './document-build.js';
import { resolveDocumentsRoot } from './document-check.js';
import { log } from './log.js';

/**
 * @param {string} projectRoot
 */
export function projectHasDocuments(projectRoot) {
    const root = resolveDocumentsRoot(projectRoot);
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
}

/**
 * Build integrated documents into the application outDir (URL-aligned).
 * @param {{ projectRoot: string, outDir: string, strict?: boolean }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, pages?: number, error?: string }>}
 */
export async function buildIntegratedDocuments(opts) {
    const projectRoot = path.resolve(opts.projectRoot);
    const outDir = path.resolve(opts.outDir);
    if (!projectHasDocuments(projectRoot)) {
        return { ok: true, skipped: true };
    }
    try {
        const result = await buildDocuments({
            projectRoot,
            outDir,
            strict: Boolean(opts.strict),
        });
        if (!result.ok) {
            const errs = (result.manifest?.diagnostics || []).filter((d) => d.severity === 'error');
            for (const d of errs.slice(0, 12)) {
                log.error(`${d.code}: ${d.message}`);
            }
            return { ok: false, error: 'document diagnostics', pages: 0 };
        }
        writeMountRootRedirects(result.manifest, outDir);
        log.info(`document mount: pages=${result.pages.length} → ${path.relative(process.cwd(), outDir) || '.'}`);
        return { ok: true, pages: result.pages.length };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`document mount failed: ${msg}`);
        return { ok: false, error: msg };
    }
}

/**
 * Emit `{routeBase}/index.html` → defaultLocale landing (for /d/ and /docs/).
 * @param {import('./document-schema.js').DocumentManifest} manifest
 * @param {string} outDir
 */
function writeMountRootRedirects(manifest, outDir) {
    const defaultLocale = manifest.defaultLocale || manifest.locales?.[0];
    if (!defaultLocale) return;
    for (const mount of manifest.mounts || []) {
        if (!mount?.routeBase || mount.routeBase === '/') continue;
        const base = String(mount.routeBase).replace(/\/$/, '');
        const target = `${base}/${defaultLocale}/`;
        const relDir = base.replace(/^\//, '');
        const abs = path.join(outDir, relDir, 'index.html');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const html = `<!DOCTYPE html>
<html lang="${escapeAttr(defaultLocale)}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0;url=${escapeAttr(target)}" />
  <link rel="canonical" href="${escapeAttr(target)}" />
  <title>Documents</title>
</head>
<body>
  <p><a href="${escapeAttr(target)}">Continue to ${escapeAttr(defaultLocale)} docs</a></p>
</body>
</html>
`;
        fs.writeFileSync(abs, html, 'utf8');
    }
}

/** @param {string} s */
function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

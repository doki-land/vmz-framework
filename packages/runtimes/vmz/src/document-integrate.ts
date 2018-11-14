/**
 * Integrated DocumentMount — build /documents into the host app dist so
 * routeBase (e.g. /d) is served as static HTML next to SSR pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildDocuments } from './document-build.js';
import { resolveDocumentsRoot } from './document-check.js';
import { pageHtmlRel } from './document-enrich.js';
import { loadLocalesRouting } from './document-routing-config.js';
import type { DocumentManifest } from './document-schema.js';
import { log } from './log.js';
import { requireNativeAddon } from './native-addon.js';

export function projectHasDocuments(projectRoot: string): boolean {
    const root = resolveDocumentsRoot(projectRoot);
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
}

export interface BuildIntegratedDocumentsOpts {
    projectRoot: string;
    outDir: string;
    strict?: boolean;
}

export interface BuildIntegratedDocumentsResult {
    ok: boolean;
    skipped?: boolean;
    pages?: number;
    error?: string;
}

/** Build integrated documents into the application outDir (URL-aligned). */
export async function buildIntegratedDocuments(opts: BuildIntegratedDocumentsOpts): Promise<BuildIntegratedDocumentsResult> {
    const projectRoot = path.resolve(opts.projectRoot);
    const outDir = path.resolve(opts.outDir);
    if (!projectHasDocuments(projectRoot)) {
        return { ok: true, skipped: true };
    }
    try {
        const result = await buildDocuments({
            projectRoot,
            outDir,
            appDistDir: outDir,
            strict: Boolean(opts.strict),
        });
        if (!result.ok) {
            const errs = (result.manifest?.diagnostics || []).filter((d) => d.severity === 'error');
            for (const d of errs.slice(0, 12)) {
                log.error(`${d.code}: ${d.message}`);
            }
            return { ok: false, error: 'document diagnostics', pages: 0 };
        }
        writeMountRootRedirects(result.manifest, outDir, projectRoot);
        log.info(`document mount: pages=${result.pages.length} → ${path.relative(process.cwd(), outDir) || '.'}`);
        return { ok: true, pages: result.pages.length };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`document mount failed: ${msg}`);
        return { ok: false, error: msg };
    }
}

/**
 * Emit `{routeBase}/index.html` for integrated mounts.
 * `routing.strategy: none` → copy default-locale docs index (LocaleId is Host state).
 * prefix strategy → redirect HTML to `{routeBase}/{defaultLocale}/`.
 */
function writeMountRootRedirects(manifest: DocumentManifest, outDir: string, projectRoot: string): void {
    const defaultLocale = manifest.defaultLocale || manifest.locales?.[0];
    if (!defaultLocale) return;
    const routing = loadLocalesRouting(projectRoot) || { strategy: 'prefix' };
    for (const mount of manifest.mounts || []) {
        if (!mount?.routeBase || mount.routeBase === '/') continue;
        const base = String(mount.routeBase).replace(/\/$/, '');
        const relDir = base.replace(/^\//, '');
        const abs = path.join(outDir, relDir, 'index.html');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (routing.strategy === 'none' || routing.strategy === 'domain') {
            const srcRel = pageHtmlRel(base, defaultLocale, 'index');
            const srcAbs = path.join(outDir, srcRel);
            if (fs.existsSync(srcAbs)) {
                fs.copyFileSync(srcAbs, abs);
            }
            continue;
        }
        const target = `${base}/${defaultLocale}/`;
        const native = requireNativeAddon();
        if (typeof native.generateRedirectHtml !== 'function') {
            throw new Error('vmz native addon missing generateRedirectHtml — rebuild with `pnpm napi:build`');
        }
        const html = native.generateRedirectHtml({
            lang: defaultLocale,
            target,
            title: 'Documents',
        });
        fs.writeFileSync(abs, html, 'utf8');
    }
}

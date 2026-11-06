/**
 * Document — wire the compiled app stylesheet and the framework-owned document
 * base layer into static document assets.
 *
 * Layering:
 * - `assets/vmz-designs.css`: the site's compiled design tokens (`vmz-designs.css`
 *   / `vmz.css` from the app build, or `designs/styles/index.css` standalone).
 * - `assets/vmz-document.css`: the framework document base (`DOCUMENT_BASE_CSS`),
 *   the single canonical layout/typography surface. Site `designs/document/*`
 *   is no longer an input — brand customization goes through `designs/tokens`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT_BASE_CSS } from './document-base-css.js';

export interface DocumentDesignsCssResult {
    /** Site token stylesheet body (empty when the project has no compiled tokens). */
    tokensCss: string;
    tokensSource: string | null;
    /** Site token stylesheet href (emitted name), null when no tokens exist. */
    tokensHref: string | null;
    /** Framework document base stylesheet href (always emitted). */
    baseHref: string;
    /** Combined source description for the manifest. */
    source: string;
}

export function resolveDocumentDesignsCss(
    projectRoot: string,
    appDistDir?: string | null,
): DocumentDesignsCssResult {
    let tokensCss = '';
    let tokensSource: string | null = null;

    if (appDistDir) {
        const compiled = [path.join(appDistDir, 'vmz-designs.css'), path.join(appDistDir, 'vmz.css')].find((p) =>
            fs.existsSync(p),
        );
        if (!compiled) {
            throw new Error(
                `vmz.document: app dist ${appDistDir} is missing vmz-designs.css / vmz.css; build the app before the documents`,
            );
        }
        tokensCss = fs.readFileSync(compiled, 'utf8');
        tokensSource = path.relative(projectRoot, compiled).replace(/\\/g, '/');
    } else {
        const entry = path.join(projectRoot, 'designs', 'styles', 'index.css');
        if (fs.existsSync(entry)) {
            tokensCss = fs.readFileSync(entry, 'utf8');
            tokensSource = 'designs/styles/index.css';
        }
    }

    return {
        tokensCss,
        tokensSource,
        tokensHref: tokensCss ? 'assets/vmz-designs.css' : null,
        baseHref: 'assets/vmz-document.css',
        source: ['vmz/document-base', tokensSource].filter(Boolean).join('+'),
    };
}

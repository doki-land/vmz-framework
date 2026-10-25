/**
 * Document — wire project `/designs` and the compiled app stylesheet into
 * static document assets.
 *
 * Layout chrome comes from `designs/document/chrome.css`. Theme tokens are not
 * re-derived here: they come from the app build output (`vmz-designs.css` /
 * `vmz.css` under `appDistDir`), which is the single compiled artifact.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DocumentDesignsCssResult {
    css: string;
    source: string | null;
    href: string | null;
}

export function resolveDocumentDesignsCss(
    projectRoot: string,
    appDistDir?: string | null,
): DocumentDesignsCssResult {
    const designsDir = path.join(projectRoot, 'designs');
    if (!fs.existsSync(designsDir) || !fs.statSync(designsDir).isDirectory()) {
        return { css: '', source: null, href: null };
    }

    const parts: string[] = [];
    const sources: string[] = [];

    // Layout first so @import stays at stylesheet top; compiled tokens follow.
    const layoutCandidates = [
        path.join(designsDir, 'document', 'chrome.css'),
        path.join(designsDir, 'styles', 'document.css'),
    ];
    for (const p of layoutCandidates) {
        if (!fs.existsSync(p)) continue;
        parts.push(fs.readFileSync(p, 'utf8'));
        sources.push(path.relative(projectRoot, p).replace(/\\/g, '/'));
        break;
    }

    if (appDistDir) {
        const compiled = [path.join(appDistDir, 'vmz-designs.css'), path.join(appDistDir, 'vmz.css')].find((p) =>
            fs.existsSync(p),
        );
        if (!compiled) {
            throw new Error(
                `vmz.document: app dist ${appDistDir} is missing vmz-designs.css / vmz.css; build the app before the documents`,
            );
        }
        parts.push(fs.readFileSync(compiled, 'utf8'));
        sources.push(path.relative(projectRoot, compiled).replace(/\\/g, '/'));
    } else {
        const entry = path.join(designsDir, 'styles', 'index.css');
        if (fs.existsSync(entry)) {
            parts.push(fs.readFileSync(entry, 'utf8'));
            sources.push(path.relative(projectRoot, entry).replace(/\\/g, '/'));
        }
    }

    if (!parts.length) {
        return { css: '', source: 'designs/', href: null };
    }
    return {
        css: parts.join('\n\n'),
        source: sources.join('+'),
        href: 'assets/vmz-designs.css',
    };
}

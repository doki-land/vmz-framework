/**
 * Document code highlight — wire `engines.code` (author surface) into the
 * markdown pipeline. Shiki is prewarmed once per build; fences render static
 * highlighted HTML through markdown-it's `highlight` callback (inline spans,
 * the document chrome owns the `<pre>` surface).
 *
 * No `engines.code` (or the plugin missing) means honest plain `<pre><code>` —
 * never an error, never a fake colored block.
 */

import { DIAG, type DocumentDiagnostic } from './document-schema.js';

export interface DocumentCodeHighlighter {
    /** Sync inline highlight for one fence body. '' → renderer falls back to escaped code. */
    highlightFenceInline(code: string, lang: string): string;
}

export interface ResolveDocumentHighlighterOpts {
    /** `engines.code` from the project plugin host (`'shiki'` supported). */
    code?: string | null;
    /** Themes to prewarm (defaults to the plugin default theme). */
    themes?: string[];
}

const SUPPORTED_CODE_ENGINES = new Set(['shiki']);

/**
 * Resolve the build-time code highlighter. `null` engine → `null` highlighter
 * (plain fences). Unknown engine → an explicit diagnostic (no silent fallback
 * to a different engine).
 */
export async function resolveDocumentCodeHighlighter(
    opts: ResolveDocumentHighlighterOpts,
    diagnostics: DocumentDiagnostic[],
): Promise<DocumentCodeHighlighter | null> {
    const engine = typeof opts.code === 'string' ? opts.code.trim() : '';
    if (!engine) return null;
    if (!SUPPORTED_CODE_ENGINES.has(engine)) {
        diagnostics.push({
            code: DIAG.FENCE_UNSUPPORTED,
            severity: 'error',
            message: `unsupported engines.code ${JSON.stringify(engine)} (supported: ${[...SUPPORTED_CODE_ENGINES].join(', ')})`,
        });
        return null;
    }

    let runtime: typeof import('@vmz/plugin-shiki/runtime');
    try {
        runtime = await import('@vmz/plugin-shiki/runtime');
    } catch {
        diagnostics.push({
            code: DIAG.FENCE_UNSUPPORTED,
            severity: 'error',
            message:
                'engines.code "shiki" needs `@vmz/plugin-shiki` (optional peer of `@vmz/vmz`).\n' +
                '  Install:  pnpm add -D @vmz/plugin-shiki',
        });
        return null;
    }

    try {
        await runtime.prewarmShiki(opts.themes?.length ? { themes: opts.themes } : {});
    } catch {
        // Bootstrap failure must not fail the build: fences degrade to plain code.
        return {
            highlightFenceInline: () => '',
        };
    }
    return {
        highlightFenceInline: (code, lang) => runtime.highlightInline(code, lang),
    };
}

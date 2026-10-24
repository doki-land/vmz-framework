/**
 * Document — resolve engines.markdown via the official plugin runtime export.
 */

export interface ResolveMarkdownEngineOpts {
    engines?: { markdown?: string };
    /** Reserved for engine resolution relative to the project (unused by markdown-it). */
    projectRoot?: string;
}

export async function resolveMarkdownEngine(opts: ResolveMarkdownEngineOpts = {}) {
    const id = opts.engines?.markdown || 'markdown-it';
    if (id !== 'markdown-it') {
        throw new Error(`unsupported engines.markdown ${JSON.stringify(id)} (markdown-it only)`);
    }

    let mod;
    try {
        // Public JS runtime export of the plugin package; never read the package directory.
        mod = await import('@vmz/plugin-markdown-it/runtime');
    } catch (err) {
        throw new Error(
            'markdown engine needs `@vmz/plugin-markdown-it` (optional peer of `@vmz/vmz`).\n' +
                '  Install:  pnpm add -D @vmz/plugin-markdown-it',
            { cause: err },
        );
    }

    if (typeof mod.analyzeMarkdown !== 'function') {
        throw new Error('cannot load markdown engine markdown-it: runtime export is missing analyzeMarkdown');
    }
    return {
        engine: id,
        analyzeMarkdown: mod.analyzeMarkdown,
        renderMarkdown: mod.renderMarkdown,
        slugify: mod.slugify,
    };
}

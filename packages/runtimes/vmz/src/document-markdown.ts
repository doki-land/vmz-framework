/**
 * Document — resolve engines.markdown via the official plugin runtime.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMaybeTs } from './plugin-host.js';

const require = createRequire(import.meta.url);

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

    let runtimeFile = null;
    try {
        const pkg = require.resolve('@vmz/plugin-markdown-it/package.json');
        runtimeFile = path.join(path.dirname(pkg), 'runtime.ts');
    } catch {
        // Developer mode: monorepo source checkout.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const fallback = path.resolve(here, '../../../plugins/vmz-plugin-markdown-it/runtime.ts');
        if (existsSync(fallback)) runtimeFile = fallback;
    }

    if (!runtimeFile || !existsSync(runtimeFile)) {
        throw new Error(
            'markdown engine needs `@vmz/plugin-markdown-it` (optional peer of `@vmz/vmz`).\n' +
                '  Install:  pnpm add -D @vmz/plugin-markdown-it',
        );
    }

    const mod = await importMaybeTs(runtimeFile);
    if (typeof mod.analyzeMarkdown !== 'function') {
        throw new Error(`cannot load markdown engine markdown-it from ${runtimeFile}`);
    }
    return {
        engine: id,
        analyzeMarkdown: mod.analyzeMarkdown,
        renderMarkdown: mod.renderMarkdown,
        slugify: mod.slugify,
    };
}

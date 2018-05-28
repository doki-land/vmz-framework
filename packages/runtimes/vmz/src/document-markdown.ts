// @ts-nocheck
/**
 * Document D1 — resolve engines.markdown via the official plugin runtime.
 * Design: 规划设计/vmz/19 §3 · 23 §0（runtime.ts；与 plugin-host 同一 importMaybeTs）.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMaybeTs } from './plugin-host.js';

const require = createRequire(import.meta.url);

/**
 * @param {{ engines?: { markdown?: string } }} [opts]
 */
export async function resolveMarkdownEngine(opts = {}) {
    const id = opts.engines?.markdown || 'markdown-it';
    if (id !== 'markdown-it') {
        throw new Error(`unsupported engines.markdown ${JSON.stringify(id)} (D1: markdown-it only)`);
    }

    let runtimeFile;
    try {
        const pkg = require.resolve('@vmz/plugin-markdown-it/package.json');
        runtimeFile = path.join(path.dirname(pkg), 'runtime.ts');
    } catch (e) {
        // Workspace fallback when package exports omit package.json.
        const here = path.dirname(fileURLToPath(import.meta.url));
        runtimeFile = path.resolve(here, '../../../plugins/vmz-plugin-markdown-it/runtime.ts');
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

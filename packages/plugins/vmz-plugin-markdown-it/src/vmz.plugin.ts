import { definePlugin, loadPluginSource } from '@vmz/plugin';
import { configureMarkdownIt, type MarkdownItRuntimeOptions } from './runtime.js';

const source = loadPluginSource(import.meta.url, '../components/MarkdownIt.vmz');

/**
 * Markdown renderer options. Omitted keys keep the deterministic defaults
 * (`html: false`, `linkify: true`, `typographer: false`, `breaks: false`).
 */
export type MarkdownItPluginOptions = MarkdownItRuntimeOptions;

/**
 * markdown-it plugin factory — register `<Markdown>` + `engines.markdown`.
 *
 * @example
 * ```ts
 * import markdownIt from '@vmz/plugin-markdown-it';
 * export default defineConfig({
 *   plugins: [markdownIt({ linkify: false })],
 *   engines: { markdown: 'markdown-it' },
 * });
 * ```
 */
export function markdownIt(options: MarkdownItPluginOptions = {}) {
    configureMarkdownIt(options);

    return definePlugin({
        name: '@vmz/plugin-markdown-it',
        version: '0.1.0',
        protocol: '0.1.0',
        stages: ['workspace_resolve', 'analyzer'],
        deterministic: true,
        async contribute(ctx) {
            if (ctx.stage === 'workspace_resolve') {
                return {
                    stage: 'workspace_resolve',
                    cacheKey: `@vmz/plugin-markdown-it:MarkdownIt.vmz:${source.contentHash.slice(0, 12)}`,
                    items: [
                        {
                            id: 'component-markdown-it',
                            kind: 'source',
                            path: 'src/components/MarkdownIt.vmz',
                            content: source.content,
                            contentHash: source.contentHash,
                            materialize: true,
                            engine: 'markdown-it',
                            engineKind: 'markdown',
                        },
                    ],
                };
            }
            if (ctx.stage === 'analyzer') {
                return {
                    stage: 'analyzer',
                    cacheKey: '@vmz/plugin-markdown-it:analyzer',
                    items: [
                        {
                            id: 'engine-markdown-it',
                            kind: 'analyzer',
                            path: 'src/components/MarkdownIt.vmz',
                            severity: 'advice',
                            message: 'markdown engine markdown-it online',
                            code: 'vmz.engine.markdown-it',
                            engine: 'markdown-it',
                            engineKind: 'markdown',
                        },
                    ],
                };
            }
            return { stage: ctx.stage, items: [] };
        },
    });
}

export default markdownIt;

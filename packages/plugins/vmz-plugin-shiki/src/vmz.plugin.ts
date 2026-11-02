import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { definePlugin, loadPluginSource } from '@vmz/plugin';
import { configureShiki, prewarmShiki } from './runtime.js';

const source = loadPluginSource(import.meta.url, '../components/Shiki.vmz');

export type ShikiPluginOptions = {
    /**
     * TextMate Shiki adapter module id (e.g. `vmz-textmate/shiki`). Explicit
     * opt-in: the host must resolve this specifier (it is not an npm
     * dependency of the plugin). Omit it to use the plain Shiki path.
     */
    textmate?: string;
    /** Default Shiki themes for prewarm. */
    themes?: string[];
};

function writeRuntimeSidecar(outDir: string, opts: ShikiPluginOptions) {
    const payload = {
        ...(opts.textmate ? { textmate: opts.textmate } : {}),
        ...(opts.themes?.length ? { themes: opts.themes } : {}),
    };
    const dir = path.join(outDir, '_vmz');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'plugin-shiki.config.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * VMZ Shiki plugin factory — register `<Shiki>` + `engines.code`.
 *
 * @example
 * ```ts
 * import shiki from '@vmz/plugin-shiki';
 * export default defineConfig({
 *   plugins: [shiki({ textmate: '@game-gpt/vos-textmate/shiki' })],
 *   engines: { code: 'shiki' },
 * });
 * ```
 */
export function shiki(options: ShikiPluginOptions = {}) {
    configureShiki({
        textmate: options.textmate,
        themes: options.themes,
    });
    // Warm the highlighter at config-load time (the same process later runs the
    // document pipeline and page SSR), so `highlightSync` hits the cache during
    // SSR and the first paint already carries the final tokenized markup — no
    // unhighlighted fallback flash. Bootstrap failure degrades to plain fences.
    void prewarmShiki({ themes: options.themes }).catch(() => {});

    return definePlugin({
        name: '@vmz/plugin-shiki',
        version: '0.1.0',
        protocol: '0.1.0',
        stages: ['workspace_resolve', 'analyzer'],
        deterministic: true,
        async contribute(ctx) {
            if (ctx.stage === 'workspace_resolve') {
                writeRuntimeSidecar(ctx.outDir, options);
                return {
                    stage: 'workspace_resolve',
                    cacheKey: `@vmz/plugin-shiki:Shiki.vmz:${source.contentHash.slice(0, 12)}:${options.textmate ?? 'generic'}`,
                    items: [
                        {
                            id: 'component-shiki',
                            kind: 'source',
                            path: 'src/components/Shiki.vmz',
                            content: source.content,
                            contentHash: source.contentHash,
                            materialize: true,
                            engine: 'shiki',
                            engineKind: 'code',
                        },
                    ],
                };
            }
            if (ctx.stage === 'analyzer') {
                return {
                    stage: 'analyzer',
                    cacheKey: '@vmz/plugin-shiki:analyzer',
                    items: [
                        {
                            id: 'engine-shiki',
                            kind: 'analyzer',
                            path: 'src/components/Shiki.vmz',
                            severity: 'advice',
                            message: 'code engine shiki online',
                            code: 'vmz.engine.shiki',
                            engine: 'shiki',
                            engineKind: 'code',
                        },
                    ],
                };
            }
            return { stage: ctx.stage, items: [] };
        },
    });
}

export default shiki;

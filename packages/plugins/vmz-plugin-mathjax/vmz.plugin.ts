import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Mathjax.vmz');

export default definePlugin({
    name: '@vmz/plugin-mathjax',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-mathjax:Mathjax.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-mathjax',
                        kind: 'source',
                        path: 'src/components/Mathjax.vmz',
                        content: source.content,
                        contentHash: source.contentHash,
                        materialize: true,
                        engine: 'mathjax',
                        engineKind: 'math',
                    },
                ],
            };
        }
        if (ctx.stage === 'analyzer') {
            return {
                stage: 'analyzer',
                cacheKey: '@vmz/plugin-mathjax:analyzer',
                items: [
                    {
                        id: 'engine-mathjax',
                        kind: 'analyzer',
                        path: 'src/components/Mathjax.vmz',
                        severity: 'advice',
                        message: 'math engine mathjax online',
                        code: 'vmz.engine.mathjax',
                        engine: 'mathjax',
                        engineKind: 'math',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

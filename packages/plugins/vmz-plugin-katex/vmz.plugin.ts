import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Katex.vmz');

export default definePlugin({
    name: '@vmz/plugin-katex',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-katex:Katex.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-katex',
                        kind: 'source',
                        path: 'src/components/Katex.vmz',
                        content: source.content,
                        contentHash: source.contentHash,
                        materialize: true,
                        engine: 'katex',
                        engineKind: 'math',
                    },
                ],
            };
        }
        if (ctx.stage === 'analyzer') {
            return {
                stage: 'analyzer',
                cacheKey: '@vmz/plugin-katex:analyzer',
                items: [
                    {
                        id: 'engine-katex',
                        kind: 'analyzer',
                        path: 'src/components/Katex.vmz',
                        severity: 'advice',
                        message: 'math engine katex online',
                        code: 'vmz.engine.katex',
                        engine: 'katex',
                        engineKind: 'math',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

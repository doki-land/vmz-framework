import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Shiki.vmz');

export default definePlugin({
    name: '@vmz/plugin-shiki',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-shiki:Shiki.vmz:${source.contentHash.slice(0, 12)}`,
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

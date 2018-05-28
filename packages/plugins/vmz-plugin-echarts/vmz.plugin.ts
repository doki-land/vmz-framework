import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Echarts.vmz');

export default definePlugin({
    name: '@vmz/plugin-echarts',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-echarts:Echarts.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-echarts',
                        kind: 'source',
                        path: 'src/components/Echarts.vmz',
                        content: source.content,
                        contentHash: source.contentHash,
                        materialize: true,
                    },
                ],
            };
        }
        if (ctx.stage === 'analyzer') {
            return {
                stage: 'analyzer',
                cacheKey: '@vmz/plugin-echarts:analyzer',
                items: [
                    {
                        id: 'component-echarts-online',
                        kind: 'analyzer',
                        path: 'src/components/Echarts.vmz',
                        severity: 'advice',
                        message: 'Echarts component online',
                        code: 'vmz.plugin.echarts',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

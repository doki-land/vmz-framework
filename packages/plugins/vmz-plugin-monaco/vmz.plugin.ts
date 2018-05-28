import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Monaco.vmz');

export default definePlugin({
    name: '@vmz/plugin-monaco',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-monaco:Monaco.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-monaco',
                        kind: 'source',
                        path: 'src/components/Monaco.vmz',
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
                cacheKey: '@vmz/plugin-monaco:analyzer',
                items: [
                    {
                        id: 'component-monaco-online',
                        kind: 'analyzer',
                        path: 'src/components/Monaco.vmz',
                        severity: 'advice',
                        message: 'Monaco component online',
                        code: 'vmz.plugin.monaco',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

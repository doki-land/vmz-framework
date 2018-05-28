import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Mermaid.vmz');

export default definePlugin({
    name: '@vmz/plugin-mermaid',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-mermaid:Mermaid.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-mermaid',
                        kind: 'source',
                        path: 'src/components/Mermaid.vmz',
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
                cacheKey: '@vmz/plugin-mermaid:analyzer',
                items: [
                    {
                        id: 'component-mermaid-online',
                        kind: 'analyzer',
                        path: 'src/components/Mermaid.vmz',
                        severity: 'advice',
                        message: 'Mermaid component online',
                        code: 'vmz.plugin.mermaid',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

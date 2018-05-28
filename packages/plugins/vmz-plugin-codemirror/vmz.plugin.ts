import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Codemirror.vmz');

export default definePlugin({
    name: '@vmz/plugin-codemirror',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-codemirror:Codemirror.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-codemirror',
                        kind: 'source',
                        path: 'src/components/Codemirror.vmz',
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
                cacheKey: '@vmz/plugin-codemirror:analyzer',
                items: [
                    {
                        id: 'component-codemirror-online',
                        kind: 'analyzer',
                        path: 'src/components/Codemirror.vmz',
                        severity: 'advice',
                        message: 'Codemirror component online',
                        code: 'vmz.plugin.codemirror',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

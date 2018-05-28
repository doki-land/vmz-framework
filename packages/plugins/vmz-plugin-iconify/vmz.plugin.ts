import { definePlugin, loadPluginSource } from '@vmz/plugin';

const source = loadPluginSource(import.meta.url, 'components/Iconify.vmz');

export default definePlugin({
    name: '@vmz/plugin-iconify',
    version: '0.1.0',
    protocol: '0.1.0',
    stages: ['workspace_resolve', 'analyzer'],
    deterministic: true,
    async contribute(ctx) {
        if (ctx.stage === 'workspace_resolve') {
            return {
                stage: 'workspace_resolve',
                cacheKey: `@vmz/plugin-iconify:Iconify.vmz:${source.contentHash.slice(0, 12)}`,
                items: [
                    {
                        id: 'component-iconify',
                        kind: 'source',
                        path: 'src/components/Iconify.vmz',
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
                cacheKey: '@vmz/plugin-iconify:analyzer',
                items: [
                    {
                        id: 'component-iconify-online',
                        kind: 'analyzer',
                        path: 'src/components/Iconify.vmz',
                        severity: 'advice',
                        message: 'Iconify component online',
                        code: 'vmz.plugin.iconify',
                    },
                ],
            };
        }
        return { stage: ctx.stage, items: [] };
    },
});

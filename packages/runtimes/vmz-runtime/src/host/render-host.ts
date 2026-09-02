/**
 * Unified SSR/DOM render host — explicit deployment bootstrap before renderToString/stream/mount.
 * Hosts must not call renderToString until ensureComponents() has run for the active closure.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BootstrapComponentRegistryOpts } from '../shared/host.types.js';
import {
    bootstrapComponentRegistry,
    collectDependsOnClosure,
    loadComponentEntries,
    readDeploymentDocument,
    importAndRegisterComponentEntries,
} from './deployment-registry.js';

export async function createRenderHost(distDir: string, opts: Record<string, unknown> = {}) {
    const strict = opts.strictDeployment === true || opts.strict === true;
    const domPath = path.join(distDir, 'vmz-dom.js');
    const dom = await import(pathToFileURL(domPath).href);
    const deployment = readDeploymentDocument(distDir, { strict });

    const loadedChunkIds = new Set<string>();

    const bootstrapOpts: BootstrapComponentRegistryOpts = {
        strict,
        explicit: opts.explicit as Record<string, string> | undefined,
        cacheBust: opts.cacheBust as string | number | undefined,
        loaded: loadedChunkIds,
        preload: (opts.preload as BootstrapComponentRegistryOpts['preload']) ?? 'none',
        closureRoots: opts.closureRoots as string[] | undefined,
    };

    if (bootstrapOpts.preload !== 'none') {
        await bootstrapComponentRegistry(distDir, dom.registerComponents, bootstrapOpts);
    }

    /**
     * Load component closure for root chunk ids (page + layouts + fixture).
     */
    async function ensureComponents(rootChunkIds) {
        if (!rootChunkIds?.length) return {};
        const entries = await loadComponentEntries(distDir, {
            strict,
            closureRoots: rootChunkIds,
            explicit: opts.explicit as Record<string, string> | undefined,
        });
        return importAndRegisterComponentEntries(distDir, entries, dom.registerComponents, {
            cacheBust: opts.cacheBust as string | number | undefined,
            loaded: loadedChunkIds,
        });
    }

    /**
     * Union closure chunk ids (pages + layouts) without importing yet.
     */
    function closureChunkIds(rootChunkIds) {
        if (!deployment || !rootChunkIds?.length) return new Set(rootChunkIds || []);
        return collectDependsOnClosure(deployment, rootChunkIds);
    }

    return {
        distDir,
        deployment,
        dom,
        loadedChunkIds,
        ensureComponents,
        closureChunkIds,
        renderToString: dom.renderToString.bind(dom),
        renderToStream: dom.renderToStream.bind(dom),
        mount: dom.mount.bind(dom),
        hydrate: dom.hydrate?.bind(dom),
        resume: dom.resume?.bind(dom),
        destroy: dom.destroy?.bind(dom),
        flushPending: dom.flushPending?.bind(dom),

        registerComponents: dom.registerComponents.bind(dom),
    };
}

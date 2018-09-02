// @ts-nocheck
/**
 * Unified SSR/DOM render host — explicit deployment bootstrap before renderToString/stream/mount.
 * Hosts must not call renderToString until ensureComponents() has run for the active closure.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    bootstrapComponentRegistry,
    collectDependsOnClosure,
    loadComponentEntries,
    readDeploymentDocument,
    importAndRegisterComponentEntries,
} from './deployment-registry.js';

/**
 * @param {string} distDir
 * @param {{
 *   strictDeployment?: boolean,
 *   strict?: boolean,
 *   explicit?: Record<string, string>,
 *   cacheBust?: string | number,
 *   preload?: 'all' | 'closure' | 'none',
 *   closureRoots?: string[],
 * }} [opts]
 */
export async function createRenderHost(distDir, opts = {}) {
    const strict = opts.strictDeployment === true || opts.strict === true;
    const domPath = path.join(distDir, 'vmz-dom.js');
    const dom = await import(pathToFileURL(domPath).href);
    const deployment = readDeploymentDocument(distDir, { strict });
    /** @type {Set<string>} */
    const loadedChunkIds = new Set();

    const bootstrapOpts = {
        strict,
        explicit: opts.explicit,
        cacheBust: opts.cacheBust,
        loaded: loadedChunkIds,
        preload: opts.preload ?? 'none',
        closureRoots: opts.closureRoots,
    };

    if (bootstrapOpts.preload !== 'none') {
        await bootstrapComponentRegistry(distDir, dom.registerComponents, bootstrapOpts);
    }

    /**
     * Load component closure for root chunk ids (page + layouts + fixture).
     * @param {string[]} rootChunkIds
     */
    async function ensureComponents(rootChunkIds) {
        if (!rootChunkIds?.length) return {};
        const entries = await loadComponentEntries(distDir, {
            strict,
            closureRoots: rootChunkIds,
            explicit: opts.explicit,
        });
        return importAndRegisterComponentEntries(distDir, entries, dom.registerComponents, {
            cacheBust: opts.cacheBust,
            loaded: loadedChunkIds,
        });
    }

    /**
     * Union closure chunk ids (pages + layouts) without importing yet.
     * @param {string[]} rootChunkIds
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
        /** @deprecated Prefer ensureComponents via createRenderHost; low-level escape hatch. */
        registerComponents: dom.registerComponents.bind(dom),
    };
}

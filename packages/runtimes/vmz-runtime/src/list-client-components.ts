// @ts-nocheck
/**
 * Discover compiled client component modules from Deployment Plan only.
 * Shared by serve-host SSR, static emit, and test hosts (plan-only host).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    bootstrapComponentRegistry,
    componentEntriesFromDeployment,
    dedupeComponentEntriesByTag,
    mergeExplicitComponentEntries,
    readDeploymentDocument,
} from './deployment-registry.js';

export {
    DEPLOYMENT_SCHEMA,
    readDeploymentDocument,
    componentEntriesFromDeployment,
    collectDependsOnClosure,
    dedupeComponentEntriesByTag,
    mergeExplicitComponentEntries,
    loadComponentEntries,
    importAndRegisterComponentEntries,
    bootstrapComponentRegistry,
} from './deployment-registry.js';

export { createRenderHost } from './render-host.js';

/**
 * @param {string} dir
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<Array<{ name: string, entry: string, chunkId?: string }>>}
 */
export async function listClientComponents(dir, opts = {}) {
    const strict = opts.strict === true;
    const deployment = readDeploymentDocument(dir, { strict });
    if (deployment) {
        return dedupeComponentEntriesByTag(
            componentEntriesFromDeployment(deployment).map((e) => ({
                chunkId: e.chunkId,
                name: e.name,
                entry: e.entry,
                source: e.source,
            })),
            { strict },
        ).map((e) => ({
            name: e.name,
            entry: e.entry,
            chunkId: e.chunkId,
        }));
    }
    if (strict) {
        throw new Error(`vmz: missing vmz-deployment.json under ${dir} (plan-only host)`);
    }
    return [];
}

/**
 * Sync variant for callers that already use fs sync (legacy static-emit helpers).
 * @param {string} dir
 * @param {{ strict?: boolean }} [opts]
 * @returns {Array<{ name: string, entry: string, chunkId?: string }>}
 */
export function listClientComponentsSync(dir, opts = {}) {
    const strict = opts.strict === true;
    const deployment = readDeploymentDocument(dir, { strict });
    if (deployment) {
        return dedupeComponentEntriesByTag(
            componentEntriesFromDeployment(deployment).map((e) => ({
                chunkId: e.chunkId,
                name: e.name,
                entry: e.entry,
                source: e.source,
            })),
            { strict },
        ).map((e) => ({
            name: e.name,
            entry: e.entry,
            chunkId: e.chunkId,
        }));
    }
    if (strict) {
        throw new Error(`vmz: missing vmz-deployment.json under ${dir} (plan-only host)`);
    }
    return [];
}

/**
 * @param {Array<{ name: string, entry: string, chunkId?: string }>} entries
 * @param {Record<string, string> | undefined} explicit
 * @returns {Array<{ name: string, entry: string, chunkId?: string }>}
 */
export function mergeComponentEntries(entries, explicit) {
    const normalized = entries.map((e) => ({
        chunkId: e.chunkId || `components/${e.name}`,
        name: e.name,
        entry: e.entry,
    }));
    return mergeExplicitComponentEntries(normalized, explicit).map((e) => ({
        name: e.name,
        entry: e.entry,
        chunkId: e.chunkId,
    }));
}

/**
 * @param {string} distDir
 * @param {Record<string, string> | undefined} [explicit]
 * @param {{ strict?: boolean, closureRoots?: string[] }} [opts]
 * @returns {Promise<Array<{ name: string, entry: string, chunkId?: string }>>}
 */
export async function resolveComponentEntries(distDir, explicit, opts = {}) {
    const { loadComponentEntries } = await import('./deployment-registry.js');
    const entries = await loadComponentEntries(distDir, {
        strict: opts.strict,
        closureRoots: opts.closureRoots,
        explicit,
    });
    return entries.map((e) => ({ name: e.name, entry: e.entry, chunkId: e.chunkId }));
}

/**
 * Import all (or filtered) client components and register for SSR / static emit / test hosts.
 * @param {string} distDir
 * @param {(map: Record<string, unknown>) => void} registerComponents
 * @param {{
 *   cacheBust?: string | number,
 *   include?: (entry: { name: string, entry: string, chunkId?: string }) => boolean,
 *   explicit?: Record<string, string>,
 *   strict?: boolean,
 *   closureRoots?: string[],
 *   preload?: 'all' | 'closure' | 'none',
 * }} [opts]
 */
export async function preloadComponentRegistry(distDir, registerComponents, opts = {}) {
    let entries = await resolveComponentEntries(distDir, opts.explicit, {
        strict: opts.strict,
        closureRoots: opts.closureRoots,
    });
    if (opts.include) entries = entries.filter((e) => opts.include(e));
    /** @type {Record<string, unknown>} */
    const map = {};
    for (const entry of entries) {
        const abs = path.join(distDir, entry.entry);
        let href = pathToFileURL(abs).href;
        if (opts.cacheBust != null && opts.cacheBust !== '') {
            href = `${href}?t=${encodeURIComponent(String(opts.cacheBust))}`;
        }
        const mod = await import(href);
        map[entry.name] = mod.default;
    }
    if (Object.keys(map).length) registerComponents(map);
    return map;
}

/**
 * Discover compiled client component modules from Deployment Plan only.
 * Shared by serve-host SSR, static emit, and test hosts (plan-only host).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
    ClientComponentListEntry,
    ComponentRegistryMap,
    ListClientComponentsOpts,
    PreloadComponentRegistryOpts,
} from '../shared/host.types.js';
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

export async function listClientComponents(dir: string, opts: ListClientComponentsOpts = {}): Promise<ClientComponentListEntry[]> {
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

export function listClientComponentsSync(dir: string, opts: ListClientComponentsOpts = {}): ClientComponentListEntry[] {
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

export function mergeComponentEntries(entries: ClientComponentListEntry[], explicit?: Record<string, string>): ClientComponentListEntry[] {
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

export async function resolveComponentEntries(
    distDir: string,
    explicit?: Record<string, string>,
    opts: ListClientComponentsOpts & { closureRoots?: string[] } = {},
): Promise<ClientComponentListEntry[]> {
    const { loadComponentEntries } = await import('./deployment-registry.js');
    const entries = await loadComponentEntries(distDir, {
        strict: opts.strict,
        closureRoots: opts.closureRoots,
        explicit,
    });
    return entries.map((e) => ({ name: e.name, entry: e.entry, chunkId: e.chunkId }));
}

export async function preloadComponentRegistry(
    distDir: string,
    registerComponents: (map: ComponentRegistryMap) => void,
    opts: PreloadComponentRegistryOpts = {},
): Promise<ComponentRegistryMap> {
    let entries = await resolveComponentEntries(distDir, opts.explicit, {
        strict: opts.strict,
        closureRoots: opts.closureRoots,
    });
    if (opts.include) entries = entries.filter((e) => opts.include!(e));
    const map: ComponentRegistryMap = {};
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

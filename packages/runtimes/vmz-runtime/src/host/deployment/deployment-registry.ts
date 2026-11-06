/**
 * Deployment graph — component registry bootstrap (shared by all SSR/DOM hosts).
 * Parse/validate and graph queries delegate to Rust vmz-artifacts via N-API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
    BootstrapComponentRegistryOpts,
    ComponentEntry,
    ComponentRegistryMap,
    DedupeComponentEntriesOpts,
    DeploymentDocument,
    ImportComponentEntriesOpts,
    LoadComponentEntriesOpts,
} from '../../shared/host.types.js';
import { loadNativeAddon, requireNativeFn } from '../native-addon.js';

export const DEPLOYMENT_SCHEMA = 'vmz.deployment.v0';

function parseDeploymentJson(jsonText: string): DeploymentDocument {
    requireNativeFn('deploymentValidate')(jsonText);
    return JSON.parse(jsonText) as DeploymentDocument;
}

export function readDeploymentDocument(distDir: string, opts: { strict?: boolean } = {}): DeploymentDocument | null {
    const strict = opts.strict === true;
    const filePath = path.join(distDir, 'vmz-deployment.json');
    if (!fs.existsSync(filePath)) {
        if (strict) {
            throw new Error(`vmz: missing vmz-deployment.json under ${distDir} (strict deployment mode)`);
        }
        return null;
    }
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        if (strict) throw new Error(`vmz: cannot read vmz-deployment.json: ${e instanceof Error ? e.message : e}`);
        return null;
    }
    try {
        return parseDeploymentJson(raw);
    } catch (e) {
        if (strict) throw new Error(`vmz: invalid vmz-deployment.json: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

export function componentEntriesFromDeployment(deployment: DeploymentDocument): ComponentEntry[] {
    const json = JSON.stringify(deployment);
    return requireNativeFn('deploymentComponentEntries')(json) as ComponentEntry[];
}

export function collectDependsOnClosure(deployment: DeploymentDocument, rootChunkIds: string[]): Set<string> {
    const json = JSON.stringify(deployment);
    const ids = requireNativeFn('deploymentDependsOnClosure')(json, rootChunkIds) as string[];
    return new Set(ids);
}

export function dedupeComponentEntriesByTag(entries: ComponentEntry[], opts: DedupeComponentEntriesOpts = {}): ComponentEntry[] {
    const strict = opts.strict === true;
    const byTag = new Map<string, ComponentEntry>();
    for (const e of entries) {
        const prev = byTag.get(e.name);
        if (prev && prev.chunkId !== e.chunkId) {
            const msg = `vmz: component tag <${e.name}> maps to both ${prev.chunkId} and ${e.chunkId}`;
            if (strict) throw new Error(msg);
            console.warn(`${msg}; using ${e.chunkId}`);
        }
        byTag.set(e.name, e);
    }
    return [...byTag.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeExplicitComponentEntries(entries: ComponentEntry[], explicit?: Record<string, string>): ComponentEntry[] {
    const byTag = new Map<string, ComponentEntry>(entries.map((e) => [e.name, e]));
    if (explicit) {
        for (const [name, chunk] of Object.entries(explicit)) {
            const chunkId = String(chunk).replace(/\\/g, '/');
            byTag.set(name, {
                chunkId,
                name,
                entry: `${chunkId}.client.js`,
                source: '',
            });
        }
    }
    return [...byTag.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadComponentEntries(distDir: string, opts: LoadComponentEntriesOpts = {}): Promise<ComponentEntry[]> {
    const strict = opts.strict === true;
    const deployment = readDeploymentDocument(distDir, { strict });
    let entries: ComponentEntry[] = [];
    if (deployment) {
        entries = componentEntriesFromDeployment(deployment);
        if (opts.closureRoots?.length) {
            const closure = collectDependsOnClosure(deployment, opts.closureRoots);
            entries = entries.filter((e) => closure.has(e.chunkId));
        }
    } else if (strict) {
        throw new Error(`vmz: missing vmz-deployment.json under ${distDir} (plan-only host)`);
    }
    entries = mergeExplicitComponentEntries(entries, opts.explicit);
    return dedupeComponentEntriesByTag(entries, { strict });
}

export async function importAndRegisterComponentEntries(
    distDir: string,
    entries: ComponentEntry[],
    registerComponents: (map: ComponentRegistryMap) => void,
    opts: ImportComponentEntriesOpts = {},
): Promise<ComponentRegistryMap> {
    const map: ComponentRegistryMap = {};
    const loaded = opts.loaded ?? null;
    const packNode = opts.unpacked ? null : readPackNodeManifest(distDir);
    for (const entry of entries) {
        if (loaded && loaded.has(entry.chunkId)) continue;
        // Node/SSR consumes the packed unit bytes (`_vmz/pack-node/`) whenever the
        // build packed the node graph — bare package imports in dependency
        // components only exist in vendored form there. Dev sessions do not pack:
        // the unpacked `${chunkId}.client.js` remains the module identity. Client
        // hosts pass `unpacked` and stay on that tree: units they mount come from
        // the unpacked client graph, including client-only fixtures that no page
        // reaches and the node graph therefore excludes.
        const abs = packNode ? packNodeEntryAbs(distDir, entry, packNode) : path.join(distDir, entry.entry);
        let href = pathToFileURL(abs).href;
        if (opts.cacheBust != null && opts.cacheBust !== '') {
            href = `${href}?t=${encodeURIComponent(String(opts.cacheBust))}`;
        }
        const mod = await import(href);
        map[entry.name] = mod.default;
        if (loaded) loaded.add(entry.chunkId);
    }
    if (Object.keys(map).length) registerComponents(map);
    return map;
}

/** `vmz.pack.node-manifest.v0` 的唯一消费点：缺失即未打包（dev），调用方回退未打包模块。 */
function readPackNodeManifest(distDir: string): { entryFiles: Array<{ logical?: string; file?: string }> } | null {
    const manifestPath = path.join(distDir, '_vmz', 'pack-node-manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    // Freshness gate: `vmz build` writes the deployment document first and packs
    // the node graph strictly after; a dev soft rebuild rewrites the deployment
    // document without re-packing. A deployment newer than the manifest means the
    // unpacked tree moved on — packed bytes are stale and must not be served.
    try {
        const deploymentMtime = fs.statSync(path.join(distDir, 'vmz-deployment.json')).mtimeMs;
        const manifestMtime = fs.statSync(manifestPath).mtimeMs;
        if (deploymentMtime > manifestMtime) return null;
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entryFiles?: Array<{ logical?: string; file?: string }> };
        return Array.isArray(parsed.entryFiles) ? { entryFiles: parsed.entryFiles } : null;
    } catch {
        return null;
    }
}

/** Packed node chunk for one component entry; missing logical/file is an explicit error, never a fallback. */
function packNodeEntryAbs(
    distDir: string,
    entry: ComponentEntry,
    manifest: { entryFiles: Array<{ logical?: string; file?: string }> },
): string {
    const hit = manifest.entryFiles.find((e) => e && e.logical === entry.chunkId);
    if (!hit || typeof hit.file !== 'string' || !hit.file) {
        throw new Error(`vmz: pack-node manifest has no entry file for "${entry.chunkId}" under ${distDir}`);
    }
    const abs = path.join(distDir, '_vmz', 'pack-node', ...hit.file.split('/'));
    if (!fs.existsSync(abs)) {
        throw new Error(`vmz: pack-node chunk missing on disk for "${entry.chunkId}": ${path.relative(distDir, abs)}`);
    }
    return abs;
}

export async function bootstrapComponentRegistry(
    distDir: string,
    registerComponents: (map: ComponentRegistryMap) => void,
    opts: BootstrapComponentRegistryOpts = {},
): Promise<ComponentRegistryMap> {
    const preload = opts.preload ?? (opts.closureRoots?.length ? 'closure' : 'all');
    if (preload === 'none') return {};
    const loadOpts: LoadComponentEntriesOpts = {
        strict: opts.strict,
        explicit: opts.explicit,
        closureRoots: preload === 'closure' ? opts.closureRoots : undefined,
    };
    const entries = await loadComponentEntries(distDir, loadOpts);
    return importAndRegisterComponentEntries(distDir, entries, registerComponents, {
        cacheBust: opts.cacheBust,
        loaded: opts.loaded,
    });
}

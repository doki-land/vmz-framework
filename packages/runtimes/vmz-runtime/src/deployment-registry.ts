// @ts-nocheck
/**
 * Deployment graph → component registry bootstrap (shared by all SSR/DOM hosts).
 * Parse/validate and graph queries delegate to Rust vmz-artifacts via N-API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNativeAddon, requireNativeFn } from './native-addon.js';

export const DEPLOYMENT_SCHEMA = 'vmz.deployment.v0';

/**
 * @param {string} jsonText
 * @returns {any}
 */
function parseDeploymentJson(jsonText) {
    requireNativeFn('deploymentValidate')(jsonText);
    return JSON.parse(jsonText);
}

/**
 * @param {string} distDir
 * @param {{ strict?: boolean }} [opts]
 * @returns {any | null}
 */
export function readDeploymentDocument(distDir, opts = {}) {
    const strict = opts.strict === true;
    const filePath = path.join(distDir, 'vmz-deployment.json');
    if (!fs.existsSync(filePath)) {
        if (strict) {
            throw new Error(`vmz: missing vmz-deployment.json under ${distDir} (strict deployment mode)`);
        }
        return null;
    }
    let raw;
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

/**
 * @param {any} deployment
 * @returns {Array<{ chunkId: string, name: string, entry: string, source: string }>}
 */
export function componentEntriesFromDeployment(deployment) {
    const json = JSON.stringify(deployment);
    return requireNativeFn('deploymentComponentEntries')(json);
}

/**
 * @param {any} deployment
 * @param {string[]} rootChunkIds
 * @returns {Set<string>}
 */
export function collectDependsOnClosure(deployment, rootChunkIds) {
    const json = JSON.stringify(deployment);
    const ids = requireNativeFn('deploymentDependsOnClosure')(json, rootChunkIds);
    return new Set(ids);
}

/**
 * Resolve tag conflicts; strict mode throws, dev mode warns and keeps last chunkId.
 * @param {Array<{ chunkId: string, name: string, entry: string, source?: string }>} entries
 * @param {{ strict?: boolean }} [opts]
 * @returns {Array<{ chunkId: string, name: string, entry: string, source?: string }>}
 */
export function dedupeComponentEntriesByTag(entries, opts = {}) {
    const strict = opts.strict === true;
    /** @type {Map<string, { chunkId: string, name: string, entry: string, source?: string }>} */
    const byTag = new Map();
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

/**
 * @param {Array<{ chunkId: string, name: string, entry: string, source?: string }>} entries
 * @param {Record<string, string> | undefined} explicit name → chunkId (no .client.js)
 * @returns {Array<{ chunkId: string, name: string, entry: string, source?: string }>}
 */
export function mergeExplicitComponentEntries(entries, explicit) {
    /** @type {Map<string, { chunkId: string, name: string, entry: string, source?: string }>} */
    const byTag = new Map(entries.map((e) => [e.name, e]));
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

/**
 * @param {string} distDir
 * @param {{
 *   strict?: boolean,
 *   closureRoots?: string[],
 *   explicit?: Record<string, string>,
 * }} [opts]
 * @returns {Promise<Array<{ chunkId: string, name: string, entry: string, source?: string }>>}
 */
export async function loadComponentEntries(distDir, opts = {}) {
    const strict = opts.strict === true;
    const deployment = readDeploymentDocument(distDir, { strict });
    /** @type {Array<{ chunkId: string, name: string, entry: string, source?: string }>} */
    let entries = [];
    if (deployment) {
        entries = componentEntriesFromDeployment(deployment);
        if (opts.closureRoots?.length) {
            const closure = collectDependsOnClosure(deployment, opts.closureRoots);
            entries = entries.filter((e) => closure.has(e.chunkId));
        }
    } else if (strict) {
        throw new Error(`vmz: missing vmz-deployment.json under ${distDir} (plan-only host)`);
    }
    // No directory scan fallback — component closure comes from Deployment Plan only.
    entries = mergeExplicitComponentEntries(entries, opts.explicit);
    return dedupeComponentEntriesByTag(entries, { strict });
}

/**
 * @param {string} distDir
 * @param {Array<{ chunkId: string, name: string, entry: string }>} entries
 * @param {(map: Record<string, unknown>) => void} registerComponents
 * @param {{
 *   cacheBust?: string | number,
 *   loaded?: Set<string>,
 * }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function importAndRegisterComponentEntries(distDir, entries, registerComponents, opts = {}) {
    /** @type {Record<string, unknown>} */
    const map = {};
    const loaded = opts.loaded ?? null;
    for (const entry of entries) {
        if (loaded && loaded.has(entry.chunkId)) continue;
        const abs = path.join(distDir, entry.entry);
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

/**
 * Bootstrap component registry from deployment (all or closure — no directory fallback).
 * @param {string} distDir
 * @param {(map: Record<string, unknown>) => void} registerComponents
 * @param {{
 *   strict?: boolean,
 *   closureRoots?: string[],
 *   explicit?: Record<string, string>,
 *   cacheBust?: string | number,
 *   loaded?: Set<string>,
 *   preload?: 'all' | 'closure' | 'none',
 * }} [opts]
 */
export async function bootstrapComponentRegistry(distDir, registerComponents, opts = {}) {
    const preload = opts.preload ?? (opts.closureRoots?.length ? 'closure' : 'all');
    if (preload === 'none') return {};
    const loadOpts = {
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

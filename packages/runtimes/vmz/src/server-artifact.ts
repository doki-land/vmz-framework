/**
 * P4 ServerArtifact — compiled route decision tree + public ServerRoute contracts
 * + internal capability units + selected runtime adapter. Web Standards Fetch entry.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SERVER_RUNTIMES } from './delivery-profile.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const SERVER_ARTIFACT_SCHEMA = 'vmz.server.artifact.v0';
export const HTTP_CONTRACT_SCHEMA = 'vmz.http.contract.v0';
export const SERVER_RUNTIME_ADAPTER_SCHEMA = 'vmz.server.runtime_adapter.v0';

const DEFAULT_RPC_PATH = '/__vmz/rpc';

/**
 * @param {string} outDir
 * @param {{
 *   profileId?: string | null,
 *   assembly?: string | null,
 *   serverRuntime?: string | null,
 *   packDigest?: string | null,
 * }} [opts]
 */
export function emitServerArtifact(outDir, opts = {}) {
    const deployment = readJson(path.join(outDir, 'vmz-deployment.json')) || { schema: null, units: [] };
    const routes = readJson(path.join(outDir, 'vmz-routes.json'));
    const routeRows = Array.isArray(routes) ? routes : [];

    const selectedRuntime = normalizeRuntime(opts.serverRuntime);
    const units = Array.isArray(deployment.units) ? deployment.units : [];

    const publicRoutes = routeRows.map((r) => ({
        verb: String(r.verb || 'GET').toUpperCase(),
        path: String(r.path || ''),
        moduleId: String(r.moduleId || ''),
        method: String(r.method || ''),
        className: r.className != null ? String(r.className) : null,
        visibility: 'public',
        kind: 'server-route',
    }));

    const publicKeys = new Set(publicRoutes.map((r) => `${r.moduleId}::${r.method}`));

    /** @type {Array<Record<string, unknown>>} */
    const internalCapabilities = [];
    for (const u of units) {
        const moduleId = u.serverModuleId != null ? String(u.serverModuleId) : '';
        if (!moduleId) continue;
        const caps = Array.isArray(u.capabilities) ? u.capabilities.map(String) : [];
        for (const method of caps) {
            const key = `${moduleId}::${method}`;
            if (publicKeys.has(key)) continue;
            internalCapabilities.push({
                chunkId: String(u.chunkId || ''),
                moduleId,
                method,
                visibility: 'internal',
                kind: 'capability',
            });
        }
    }

    const routeDecisionTree = [
        {
            id: 'rpc',
            match: { method: 'POST', path: DEFAULT_RPC_PATH },
            action: 'invoke-rpc',
            visibility: 'internal-transport',
        },
        ...publicRoutes.map((r, i) => ({
            id: `public-route-${i}`,
            match: { method: r.verb, path: r.path },
            action: 'invoke-server-route',
            target: { moduleId: r.moduleId, method: r.method },
            visibility: 'public',
        })),
    ];

    const httpContractBody = {
        schema: HTTP_CONTRACT_SCHEMA,
        rpcPath: DEFAULT_RPC_PATH,
        publicRoutes: publicRoutes.map((r) => ({
            verb: r.verb,
            path: r.path,
            moduleId: r.moduleId,
            method: r.method,
        })),
        internalCapabilityCount: internalCapabilities.length,
        entry: 'fetch',
    };
    const httpContractDigest = sha256Hex(canonicalJson(httpContractBody));

    const artifact = {
        schema: SERVER_ARTIFACT_SCHEMA,
        profileId: opts.profileId || null,
        assembly: opts.assembly || null,
        selectedRuntime,
        entry: {
            kind: 'fetch',
            standards: ['Request', 'Response', 'Streams', 'AbortSignal'],
            rpcPath: DEFAULT_RPC_PATH,
        },
        httpContract: {
            schema: HTTP_CONTRACT_SCHEMA,
            digest: httpContractDigest,
        },
        publicRoutes,
        internalCapabilities,
        middlewareUnits: [],
        routeDecisionTree,
        deploymentSchema: deployment.schema || null,
        packDigest: opts.packDigest || null,
        adapters: {
            node: { kind: 'node-http', status: 'runtime', entry: 'handleNodeRequest' },
            worker: { kind: 'fetch', status: 'runtime', entry: 'handleFetchRequest' },
            deno: { kind: 'fetch', status: 'projected', entry: 'handleFetchRequest' },
            bun: { kind: 'fetch', status: 'projected', entry: 'handleFetchRequest' },
            'rust-host': { kind: 'contract-projection', status: 'projected', entry: 'fetch' },
        },
    };
    artifact.artifactDigest = sha256Hex(canonicalJson({ ...artifact, artifactDigest: undefined }));

    const vmzDir = path.join(outDir, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'server-artifact.json');
    writePrettyJsonFile(file, artifact);

    const adapterDir = path.join(vmzDir, 'adapters');
    mkdirSync(adapterDir, { recursive: true });
    for (const adapterId of ['worker', 'rust-host']) {
        const projection = projectServerRuntimeAdapter(artifact, adapterId);
        const dir = path.join(adapterDir, adapterId);
        mkdirSync(dir, { recursive: true });
        writePrettyJsonFile(path.join(dir, 'adapter.json'), projection);
    }

    return { artifact, path: file, httpContractDigest };
}

/**
 * @param {Record<string, any>} artifact
 * @param {string} adapterId
 */
export function projectServerRuntimeAdapter(artifact, adapterId) {
    const id = String(adapterId || '').trim();
    if (!SERVER_RUNTIMES.includes(id) && id !== 'worker') {
        throw new Error(`projectServerRuntimeAdapter: unknown adapter ${id}`);
    }
    const base = {
        schema: SERVER_RUNTIME_ADAPTER_SCHEMA,
        adapterId: id,
        artifactDigest: artifact.artifactDigest,
        httpContractDigest: artifact.httpContract?.digest || null,
        spaFallback: false,
        entry: artifact.entry,
        publicRouteCount: Array.isArray(artifact.publicRoutes) ? artifact.publicRoutes.length : 0,
        internalCapabilityCount: Array.isArray(artifact.internalCapabilities) ? artifact.internalCapabilities.length : 0,
    };
    if (id === 'node') {
        return { ...base, host: 'node:http', invoke: 'handleNodeRequest', status: 'runtime' };
    }
    if (id === 'worker' || id === 'deno' || id === 'bun') {
        return {
            ...base,
            host: 'fetch',
            invoke: 'handleFetchRequest',
            status: id === 'worker' ? 'runtime' : 'projected',
            note:
                id === 'worker'
                    ? 'Fetch entry; live thin gated via worker-shaped subprocess host'
                    : 'Fetch contract projection; live runtime not gated',
        };
    }
    // rust-host
    return {
        ...base,
        host: 'rust-fetch-consumer',
        invoke: 'fetch',
        status: 'projected',
        note: 'contract projection only — live Rust host binary parity not gated',
        consumes: ['server-artifact.json', 'vmz-routes.json', 'vmz-deployment.json'],
    };
}

function normalizeRuntime(raw) {
    const v = String(raw || 'node').trim();
    return SERVER_RUNTIMES.includes(v) ? v : 'node';
}

function readJson(file) {
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
        return out;
    }
    return value;
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

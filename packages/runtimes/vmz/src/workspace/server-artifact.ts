/**
 * P4 ServerArtifact — thin host write of Rust/N-API normalized Plan.
 * Assembly / digests / adapters live in vmz-artifacts via N-API.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { requireNativeAddon } from './native-addon.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const SERVER_ARTIFACT_SCHEMA = 'vmz.server.artifact.v0';
export const HTTP_CONTRACT_SCHEMA = 'vmz.http.contract.v0';
export const SERVER_RUNTIME_ADAPTER_SCHEMA = 'vmz.server.runtime_adapter.v0';

interface ServerArtifactOpts {
    profileId?: string | null;
    assembly?: string | null;
    serverRuntime?: string | null;
    packDigest?: string | null;
}

interface ServerArtifactBody {
    schema: string;
    profileId: string | null;
    assembly: string | null;
    selectedRuntime: string;
    entry: { kind: string; standards: string[]; rpcPath: string };
    httpContract: { schema: string; digest: string };
    publicRoutes: Array<Record<string, unknown>>;
    internalCapabilities: Array<Record<string, unknown>>;
    middlewareUnits: unknown[];
    routeDecisionTree: unknown[];
    deploymentSchema: unknown;
    packDigest: string | null;
    adapters: Record<string, unknown>;
    artifactDigest?: string;
    [key: string]: unknown;
}

export function emitServerArtifact(outDir: string, opts: ServerArtifactOpts = {}) {
    const deploymentPath = path.join(outDir, 'vmz-deployment.json');
    const routesPath = path.join(outDir, 'vmz-routes.json');
    const deploymentJson = existsSync(deploymentPath) ? readFileSync(deploymentPath, 'utf8') : '{}';
    const routesJson = existsSync(routesPath) ? readFileSync(routesPath, 'utf8') : '[]';

    const native = requireNativeAddon();
    if (typeof native.normalizeServerArtifactJson !== 'function') {
        throw new Error('vmz native addon missing normalizeServerArtifactJson — rebuild with `pnpm napi:build`');
    }

    const artifactJson = native.normalizeServerArtifactJson(deploymentJson, routesJson, {
        profileId: opts.profileId ?? null,
        assembly: opts.assembly ?? null,
        serverRuntime: opts.serverRuntime ?? null,
        packDigest: opts.packDigest ?? null,
    });
    const artifact = JSON.parse(artifactJson) as ServerArtifactBody;

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

    return {
        artifact,
        path: file,
        httpContractDigest: artifact.httpContract?.digest || null,
    };
}

/**
 * Project a runtime adapter document from a normalized artifact (N-API).
 */
export function projectServerRuntimeAdapter(artifact: Record<string, unknown>, adapterId: string) {
    const native = requireNativeAddon();
    if (typeof native.projectServerRuntimeAdapterJson !== 'function') {
        throw new Error('vmz native addon missing projectServerRuntimeAdapterJson — rebuild with `pnpm napi:build`');
    }
    return JSON.parse(native.projectServerRuntimeAdapterJson(JSON.stringify(artifact), String(adapterId || '').trim()));
}

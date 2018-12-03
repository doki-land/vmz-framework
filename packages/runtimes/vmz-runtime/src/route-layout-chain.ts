/**
 * Layout chain from Deployment Plan only (plan-only host).
 */

import { readDeploymentDocument } from './deployment-registry.js';

/** Chunk id for `src/Application.vmz` emit (`Application.client.js`). */
export const APPLICATION_SHELL_CHUNK = 'Application';

/**
 * True when Deployment Plan lists an Application shell unit.
 */
export function hasApplicationShell(distDir: string): boolean {
    const deployment = readDeploymentDocument(distDir, { strict: false });
    const units = Array.isArray(deployment?.units) ? deployment.units : [];
    return units.some((u: { chunkId?: string }) => String(u?.chunkId || '') === APPLICATION_SHELL_CHUNK);
}

/**
 * Nested layout ids from Plan for a page (excludes Application).
 * Prefer `resolveRouteLayoutChain` for SSR / hydrate.
 */
export function resolveNestedLayoutChain(distDir: string, pageChunkId: string): string[] {
    return resolveRouteLayoutChain(distDir, pageChunkId).filter((id) => id !== APPLICATION_SHELL_CHUNK);
}

/**
 * Full SSR / hydrate layout chain from Deployment Plan `layoutChain`.
 */
export function resolveRouteLayoutChain(distDir: string, pageChunkId: string): string[] {
    const deployment = readDeploymentDocument(distDir, { strict: true });
    const units = Array.isArray(deployment?.units) ? deployment.units : [];
    const unit = units.find((u: { chunkId?: string }) => String(u?.chunkId || '').replace(/\\/g, '/') === pageChunkId);
    if (!unit) {
        throw new Error(`resolveRouteLayoutChain: no deployment unit for ${pageChunkId} (plan-only host)`);
    }
    if (!Array.isArray(unit.layoutChain)) {
        throw new Error(
            `resolveRouteLayoutChain: page unit ${pageChunkId} missing layoutChain (plan-only host)`,
        );
    }
    return unit.layoutChain.map((id: string) => String(id));
}

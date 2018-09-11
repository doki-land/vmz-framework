/**
 * File-route layout chain: Application shell (outermost) + nested page Layout components.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/** Chunk id for `src/Application.vmz` emit (`Application.client.js`). */
export const APPLICATION_SHELL_CHUNK = 'Application';

/**
 * True when the compile output includes a root Application shell.
 */
export function hasApplicationShell(distDir: string): boolean {
    return existsSync(path.join(distDir, `${APPLICATION_SHELL_CHUNK}.client.js`));
}

/**
 * Nearest page Layout.client.js walking up from the page chunk (outer to inner).
 * Does not include Application — use resolveRouteLayoutChain.
 */
export function resolveNestedLayoutChain(distDir: string, pageChunkId: string): string[] {
    const rel = pageChunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    parts.pop();
    const chain: string[] = [];
    for (let i = parts.length; i >= 0; i--) {
        const dirParts = parts.slice(0, i);
        const layoutChunk = ['pages', ...dirParts, 'Layout'].join('/');
        if (existsSync(path.join(distDir, `${layoutChunk}.client.js`))) {
            chain.unshift(layoutChunk);
        }
    }
    return chain;
}

/**
 * Full SSR / hydrate layout chain: optional Application shell, then nested page layouts.
 */
export function resolveRouteLayoutChain(distDir: string, pageChunkId: string): string[] {
    const chain = resolveNestedLayoutChain(distDir, pageChunkId);
    if (hasApplicationShell(distDir)) {
        chain.unshift(APPLICATION_SHELL_CHUNK);
    }
    return chain;
}

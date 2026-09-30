import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SseClient } from '../../shared/host.types.js';

export function resolveServeDistDir() {
    if (process.env.VMZ_DIST) return path.resolve(process.env.VMZ_DIST);
    const hostDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const norm = hostDir.replace(/\\/g, '/');
    const marker = '/_vmz/host';
    const idx = norm.toLowerCase().lastIndexOf(marker);
    if (idx >= 0) return path.resolve(hostDir.slice(0, idx));
    return hostDir;
}

export const serveState = {
    distDir: resolveServeDistDir(),
    appPackageRequire: null as ReturnType<typeof import('node:module').createRequire> | null,
    host: process.env.VMZ_HOST || '127.0.0.1',
    port: Number(process.env.VMZ_PORT || process.env.PORT || 5173),
    isDev: process.env.VMZ_DEV === '1' || process.env.VMZ_DEV === 'true',
    reloadToken: Date.now(),
    ssrRenderHost: null as Awaited<ReturnType<typeof import('../render/render-host.js').createRenderHost>> | null,
    lastDevBuildId: null as string | null,
    pageCatalog: [] as any[],
    pageCtors: new Map<string, any>(),
    cssEntry: null as string | null,
    styleBundleHash: null as string | null,
    styleTheme: null as any,
    localeArtifact: null as any,
    localeLinkPlan: null as any,
    sseClients: new Set<SseClient>(),
    inFlight: 0,
    shuttingDown: false,
    ready: false,
    lastDevError: null as { message: string; stack?: string; at: number } | null,
    server: null as Server | null,
};

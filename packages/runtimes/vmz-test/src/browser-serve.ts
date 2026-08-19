/**
 * Browser Host U2 — real VMZ serve-host lifecycle + RouteId → path resolution.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export type ServeHostHandle = {
    port: number;
    origin: string;
    kill: () => void;
};

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
            const addr = s.address();
            if (!addr || typeof addr === 'string') {
                s.close();
                reject(new Error('freePort: no address'));
                return;
            }
            const port = addr.port;
            s.close((err) => (err ? reject(err) : resolve(port)));
        });
        s.on('error', reject);
    });
}

/**
 * Resolve author RouteId / pathPattern to a pathname for page.goto.
 * Prefers explicit path; then `vmz-deployment.json` pathPattern; then CDN / realization.
 */
export function resolveRoutePath(outDir: string, opts: { routeId?: string; path?: string; params?: Record<string, string> }): string {
    if (typeof opts.path === 'string' && opts.path.trim()) {
        return applyParams(opts.path.trim(), opts.params);
    }
    const routeId = String(opts.routeId || '').trim();
    if (!routeId) throw new Error('open/navigate: routeId or path required');

    const depPath = path.join(outDir, 'vmz-deployment.json');
    if (fs.existsSync(depPath)) {
        try {
            const dep = JSON.parse(fs.readFileSync(depPath, 'utf8')) as {
                units?: Array<{ kind?: string; chunkId?: string; routeId?: string; pathPattern?: string }>;
            };
            const units = Array.isArray(dep.units) ? dep.units : [];
            const pages = units.filter((u) => u.kind === 'page');
            const hit =
                pages.find((u) => u.routeId === routeId) ||
                pages.find((u) => u.chunkId === routeId) ||
                pages.find((u) => u.chunkId === `pages/${routeId}`) ||
                pages.find((u) => String(u.chunkId || '').endsWith(`/${routeId}`));
            const pattern = String(hit?.pathPattern || '').trim();
            if (pattern) return applyParams(pattern, opts.params);
        } catch {
            /* fall through */
        }
    }

    const cdnPath = path.join(outDir, '_vmz', 'cdn-policy-manifest.json');
    if (fs.existsSync(cdnPath)) {
        try {
            const doc = JSON.parse(fs.readFileSync(cdnPath, 'utf8')) as {
                entries?: Array<{ routeId?: string; path?: string; localeId?: string }>;
            };
            const entries = Array.isArray(doc.entries) ? doc.entries : [];
            const hit =
                entries.find((e) => e.routeId === routeId && (!e.localeId || e.localeId === 'en-us') && e.path) ||
                entries.find((e) => e.routeId === routeId && e.path);
            if (hit?.path) return applyParams(String(hit.path), opts.params);
        } catch {
            /* fall through */
        }
    }

    const rrPath = path.join(outDir, '_vmz', 'route-realization.json');
    if (fs.existsSync(rrPath)) {
        try {
            const doc = JSON.parse(fs.readFileSync(rrPath, 'utf8')) as {
                routes?: Array<{ routeId?: string; pathPattern?: string }>;
            };
            const routes = Array.isArray(doc.routes) ? doc.routes : [];
            const hit =
                routes.find((r) => r.routeId === routeId) ||
                routes.find((r) => r.routeId === `pages/${routeId}`) ||
                routes.find((r) => String(r.routeId || '').endsWith(`/${routeId}`));
            if (hit?.pathPattern) return applyParams(String(hit.pathPattern), opts.params);
        } catch {
            /* fall through */
        }
    }

    throw new Error(`open/navigate: cannot resolve RouteId ${JSON.stringify(routeId)} (no path / cdn / realization)`);
}

function applyParams(pattern: string, params?: Record<string, string>): string {
    if (!params) return pattern;
    let out = pattern;
    for (const [k, v] of Object.entries(params)) {
        out = out.replace(new RegExp(`\\[${k}\\]`, 'g'), encodeURIComponent(String(v)));
        out = out.replace(new RegExp(`:${k}\\b`, 'g'), encodeURIComponent(String(v)));
    }
    return out;
}

export async function startServeHost(outDir: string): Promise<ServeHostHandle> {
    const hostJs = path.join(outDir, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) {
        throw new Error(`serve host: missing ${hostJs} (run vmz build for application dist)`);
    }
    const port = await freePort();
    const child: ChildProcess = spawn(process.execPath, [hostJs], {
        cwd: outDir,
        env: { ...process.env, VMZ_DIST: outDir, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = () => {
        try {
            child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
    };
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
            kill();
            reject(new Error(`serve host start timeout :${port}`));
        }, 12000);
        const onData = (buf: Buffer) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(t);
                child.stdout?.off('data', onData);
                resolve();
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', () => {
            /* absorb */
        });
        child.on('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`serve host exited early ${code}`));
        });
    });
    return { port, origin: `http://127.0.0.1:${port}`, kill };
}

export function isServeHostManifest(manifest: Record<string, unknown>): boolean {
    const host = manifest.host && typeof manifest.host === 'object' ? (manifest.host as Record<string, unknown>) : null;
    if (host && (host.kind === 'serve' || host.mode === 'serve')) return true;
    const program = manifest.program && typeof manifest.program === 'object' ? (manifest.program as Record<string, unknown>) : null;
    if (program && (program.kind === 'application' || program.host === 'serve')) return true;
    const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
    return actions.some((raw) => {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        return a.kind === 'open' || a.kind === 'navigate';
    });
}

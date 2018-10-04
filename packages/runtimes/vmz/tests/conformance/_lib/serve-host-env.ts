/**
 * Env for spawning `dist/vmz-serve-host.mjs`.
 * Mirrors `vmz serve` / `vmz dev` (`VMZ_NATIVE_NODE`); copied hosts cannot
 * resolve `@vmz/vmz-<platform>` from an example `dist/` alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveNativePath } from 'vmz';

export function serveHostChildEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        VMZ_NATIVE_NODE: resolveNativePath(),
        ...extra,
    };
}

/**
 * Child env for serve-host spawned from an application project directory.
 * @param {string} projectRoot
 * @param {Record<string, string | undefined>} [extra]
 */
export function serveHostProjectEnv(projectRoot: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return serveHostChildEnv({
        VMZ_PROJECT_ROOT: projectRoot,
        ...extra,
    });
}

/**
 * Prefer nested `dist/<profile>` (builtin default `web-ssr`) over a stale flat `dist/`.
 * Markers: serve-host, `_vmz/`, or `index.html` (static profile).
 * @param {string} projectDir
 * @param {string} [profile]
 */
export function resolveDeliveryDist(projectDir: string, profile = 'web-ssr'): string {
    return resolveProfileArtifactDir(path.join(projectDir, 'dist'), profile);
}

/**
 * Resolve artifact dir under an explicit out-dir root (`--out-dir` + `profiles.*.name`).
 * @param {string} outDirRoot
 * @param {string} [profile]
 */
export function resolveProfileArtifactDir(outDirRoot: string, profile = 'web-ssr'): string {
    const nested = path.join(outDirRoot, profile);
    if (isDeliveryArtifactDir(nested)) return nested;
    if (isDeliveryArtifactDir(outDirRoot)) return outDirRoot;
    throw new Error(`missing delivery artifacts under ${outDirRoot}[/${profile}]`);
}

function isDeliveryArtifactDir(dir: string): boolean {
    return (
        fs.existsSync(path.join(dir, 'vmz-serve-host.mjs')) ||
        fs.existsSync(path.join(dir, 'index.html')) ||
        fs.existsSync(path.join(dir, '_vmz'))
    );
}

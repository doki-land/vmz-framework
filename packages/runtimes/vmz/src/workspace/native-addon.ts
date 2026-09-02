/**
 * Load the N-API `.node` addon without importing `index.js`
 * (avoids cycles with modules re-exported from the package entry).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export interface NativeAddon {
    generatePrettyJson?: (json: string) => string;
    authorJson5ToCanonicalJson?: (source: string) => string;
    loadLocalePlan?: (projectRoot: string) => string;
    loadDocumentRoutePlan?: (projectRoot: string) => string;
    [key: string]: unknown;
}

let cached: NativeAddon | null | undefined;

/** Load the N-API addon or throw (production printers must not fall back to TS). */
export function requireNativeAddon(): NativeAddon {
    const native = tryLoadNativeAddon();
    if (!native) {
        throw new Error('vmz native addon missing — run `pnpm napi:build` (CodeGenerators live in vmz-generator via N-API)');
    }
    return native;
}

export function tryLoadNativeAddon(): NativeAddon | null {
    if (cached !== undefined) return cached;
    try {
        const envPath = (typeof process.env.VMZ_NATIVE_NODE === 'string' && process.env.VMZ_NATIVE_NODE.trim()) || '';
        if (envPath) {
            cached = require(path.resolve(envPath));
            return cached;
        }
        const { platform, arch } = process;
        let triple = `${platform}-${arch}`;
        if (platform === 'win32' && arch === 'x64') triple = 'win32-x64-msvc';
        else if (platform === 'win32' && arch === 'arm64') triple = 'win32-arm64-msvc';
        else if (platform === 'darwin' && arch === 'arm64') triple = 'darwin-arm64';
        else if (platform === 'darwin' && arch === 'x64') triple = 'darwin-x64';
        else if (platform === 'linux' && arch === 'x64') triple = 'linux-x64-gnu';
        else if (platform === 'linux' && arch === 'arm64') triple = 'linux-arm64-gnu';
        const short =
            triple === 'win32-x64-msvc'
                ? 'win32-x64'
                : triple === 'win32-arm64-msvc'
                  ? 'win32-arm64'
                  : triple === 'linux-x64-gnu'
                    ? 'linux-x64'
                    : triple === 'linux-arm64-gnu'
                      ? 'linux-arm64'
                      : triple;
        const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
        const name = `@vmz/vmz-${short}`;
        const candidates: string[] = [];
        try {
            const resolved = require.resolve(`${name}/package.json`);
            const dir = path.dirname(resolved);
            candidates.push(path.join(dir, `vmz.${triple}.node`), path.join(dir, 'vmz.node'));
        } catch {
            /* optional */
        }
        candidates.push(path.join(pkgRoot, 'node_modules', name, `vmz.${triple}.node`), path.join(pkgRoot, 'node_modules', name, 'vmz.node'));
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                cached = require(p);
                return cached;
            }
        }
        cached = null;
    } catch {
        cached = null;
    }
    return cached;
}

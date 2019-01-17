/**
 * Discover and load the vmz N-API addon (same contract as `@vmz/vmz` loadNative).
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeAddon } from '../shared/host.types.js';

const require = createRequire(import.meta.url);

let _nativeAddon: NativeAddon | null | undefined;

function platformTriple(): string {
    const { platform, arch } = process;
    if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc';
    if (platform === 'win32' && arch === 'arm64') return 'win32-arm64-msvc';
    if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
    if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
    if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
    if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
    return `${platform}-${arch}`;
}

function platformShort(triple: string): string {
    if (triple === 'win32-x64-msvc') return 'win32-x64';
    if (triple === 'win32-arm64-msvc') return 'win32-arm64';
    if (triple === 'linux-x64-gnu') return 'linux-x64';
    if (triple === 'linux-arm64-gnu') return 'linux-arm64';
    return triple;
}

function nativeCandidatePaths(): string[] {
    const triple = platformTriple();
    const short = platformShort(triple);
    const name = `@vmz/vmz-${short}`;
    const candidates: string[] = [];
    try {
        const resolved = require.resolve(`${name}/package.json`);
        const dir = path.dirname(resolved);
        candidates.push(path.join(dir, `vmz.${triple}.node`), path.join(dir, 'vmz.node'));
    } catch {
        /* optional dep not installed */
    }
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 12; depth++) {
        candidates.push(path.join(dir, 'node_modules', name, `vmz.${triple}.node`), path.join(dir, 'node_modules', name, 'vmz.node'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return candidates;
}

export function loadNativeAddon(): NativeAddon {
    if (_nativeAddon !== undefined) {
        if (!_nativeAddon) {
            throw new Error('vmz native addon missing — run `pnpm napi:build`');
        }
        return _nativeAddon;
    }
    try {
        const envPath = (typeof process.env.VMZ_NATIVE_NODE === 'string' && process.env.VMZ_NATIVE_NODE.trim()) || '';
        if (envPath) {
            _nativeAddon = require(path.resolve(envPath)) as NativeAddon;
            return _nativeAddon;
        }
        for (const p of nativeCandidatePaths()) {
            if (existsSync(p)) {
                _nativeAddon = require(p) as NativeAddon;
                return _nativeAddon;
            }
        }
        _nativeAddon = null;
    } catch {
        _nativeAddon = null;
    }
    if (!_nativeAddon) {
        throw new Error('vmz native addon missing — run `pnpm napi:build`');
    }
    return _nativeAddon;
}

export function requireNativeFn(fnName: string): (...args: unknown[]) => unknown {
    const native = loadNativeAddon();
    const fn = native[fnName];
    if (typeof fn !== 'function') {
        throw new Error(`vmz native addon missing ${fnName} — run \`pnpm napi:build\``);
    }
    return fn as (...args: unknown[]) => unknown;
}

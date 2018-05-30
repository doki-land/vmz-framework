// @ts-nocheck
/**
 * Resolve the native `vmz` CLI binary (vmz-tools), never the Node wrapper.
 * Used by `vmz lsp` / `vmz mcp` so stdio servers stay one binary for all hosts.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = process.platform === 'win32' ? 'vmz.exe' : 'vmz';

/**
 * @param {string} [startDir]
 * @returns {string | null}
 */
export function findRepoRoot(startDir = process.cwd()) {
    let dir = path.resolve(startDir);
    for (let i = 0; i < 12; i++) {
        if (existsSync(path.join(dir, 'Cargo.toml')) && existsSync(path.join(dir, 'package.json'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * Prefer the newer of release/debug so a fresh `cargo build` is not shadowed by a stale release.
 * @param {string} repo
 * @returns {string | null}
 */
function pickNewestProfileBinary(repo) {
    /** @type {{ path: string, mtime: number } | null} */
    let best = null;
    for (const profile of ['release', 'debug']) {
        const candidate = path.join(repo, 'target', profile, exe);
        if (!existsSync(candidate)) continue;
        let mtime = 0;
        try {
            mtime = statSync(candidate).mtimeMs;
        } catch {
            continue;
        }
        if (!best || mtime > best.mtime) best = { path: candidate, mtime };
    }
    return best?.path ?? null;
}

/**
 * @param {{ cwd?: string }} [opts]
 * @returns {string | null} absolute path to native vmz binary
 */
export function resolveNativeVmzCli(opts = {}) {
    if (typeof process.env.VMZ_NATIVE === 'string' && process.env.VMZ_NATIVE.trim()) {
        const p = path.resolve(process.env.VMZ_NATIVE.trim());
        if (existsSync(p)) return p;
    }

    const roots = [];
    if (opts.cwd) roots.push(path.resolve(opts.cwd));
    roots.push(process.cwd());
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        // packages/runtimes/vmz/dist → repo root
        roots.push(path.resolve(here, '../../../..'));
    } catch {
        /* ignore */
    }

    const seen = new Set();
    for (const start of roots) {
        const repo = findRepoRoot(start);
        if (!repo || seen.has(repo)) continue;
        seen.add(repo);
        const picked = pickNewestProfileBinary(repo);
        if (picked) return picked;
    }
    return null;
}

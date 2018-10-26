// @ts-nocheck
/**
 * `vmz` CLI invocation modes (JS gate for `@vmz/vmz` only).
 *
 * Product install face: workspace `vmz` / publish `@vmz/vmz` (bin still `vmz`).
 *
 * Three modes — do not collapse them:
 * - **developer**: monorepo source checkout (`packages/runtimes/vmz`, not under node_modules)
 * - **project**: app's nearest `node_modules/vmz` or `node_modules/@vmz/vmz`
 * - **global**: npm/pnpm global (or any install under node_modules that is not the nearest project one)
 *
 */

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vmzCliLocalize } from './cli-localize.js';

/** @typedef {'developer' | 'project' | 'global'} InvocationMode */

const PROJECT_PKG_SEGMENTS = [['@vmz', 'vmz'], ['vmz']];

/**
 * Package root of the running `vmz` / `@vmz/vmz` install.
 * @param {string} [fromUrl]
 */
export function resolveThisPackageRoot(fromUrl = import.meta.url) {
    return path.resolve(path.dirname(fileURLToPath(fromUrl)), '..');
}

/**
 * @param {string} p
 */
function tryRealpath(p) {
    try {
        return realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/**
 * Walk from `startDir` for nearest project CLI package root.
 * @param {string} startDir
 * @returns {string | null}
 */
export function findNearestProjectVmz(startDir) {
    let dir = path.resolve(startDir);
    for (;;) {
        for (const segments of PROJECT_PKG_SEGMENTS) {
            const candidate = path.join(dir, 'node_modules', ...segments);
            const pkgJson = path.join(candidate, 'package.json');
            if (existsSync(pkgJson)) {
                return tryRealpath(candidate);
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Resolve CLI entry (`bin/vmz.js`).
 * @param {string} packageRoot
 * @returns {string | null}
 */
export function resolveVmzBin(packageRoot) {
    const bin = path.join(packageRoot, 'bin', 'vmz.js');
    if (existsSync(bin)) return tryRealpath(bin);
    return null;
}

/**
 * @param {string} packageRoot
 */
export function isUnderNodeModules(packageRoot) {
    const norm = path.normalize(packageRoot);
    const parts = norm.split(path.sep);
    return parts.includes('node_modules');
}

/**
 * @param {{
 * cwd?: string,
 * thisPackageRoot?: string,
 * }} [opts]
 */
export function getInvocationContext(opts = {}) {
    const cwd = path.resolve(opts.cwd ?? process.cwd());
    const thisPackageRoot = tryRealpath(opts.thisPackageRoot ?? resolveThisPackageRoot());
    const nearestProjectVmz = findNearestProjectVmz(cwd);
    const underNm = isUnderNodeModules(thisPackageRoot);

    /** @type {InvocationMode} */
    let mode;
    if (!underNm) {
        mode = 'developer';
    } else if (nearestProjectVmz != null && nearestProjectVmz === thisPackageRoot) {
        mode = 'project';
    } else {
        mode = 'global';
    }

    return {
        mode,
        cwd,
        thisPackageRoot,
        nearestProjectVmz,
        isDeveloper: mode === 'developer',
        isProjectLocal: mode === 'project',
        /** @deprecated prefer `mode === 'global'`; kept for call sites */
        isGlobalLike: mode === 'global',
    };
}

/**
 * @param {string | undefined} cmd
 */
export function isGlobalAllowedCommand(cmd) {
    if (!cmd) return true;
    return cmd === 'help' || cmd === '-h' || cmd === '--help' || cmd === 'version' || cmd === '-V' || cmd === '--version';
}

/**
 * @param {string} bin
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export function reexecProjectVmz(bin, argv) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [bin, ...argv], {
            stdio: 'inherit',
            env: process.env,
        });
        child.on('error', () => resolve(1));
        child.on('exit', (code, signal) => {
            if (signal) resolve(1);
            else resolve(code ?? 1);
        });
    });
}

/**
 * @returns {Promise<{ action: 'proceed' } | { action: 'exit', code: number }>}
 */
export async function gateGlobalProjectCommand(opts) {
    const { argv, cwd = process.cwd(), thisPackageRoot, reexec = reexecProjectVmz, logError = (msg) => console.error(msg) } = opts;
    const ctx = getInvocationContext({ cwd, thisPackageRoot });
    if (ctx.mode !== 'global') {
        return { action: 'proceed' };
    }
    if (ctx.nearestProjectVmz && ctx.nearestProjectVmz !== ctx.thisPackageRoot) {
        const bin = resolveVmzBin(ctx.nearestProjectVmz);
        if (!bin) {
            logError(vmzCliLocalize.t('cli.err.project_bin_missing'));
            return { action: 'exit', code: 1 };
        }
        const code = await reexec(bin, argv);
        return { action: 'exit', code };
    }
    logError(vmzCliLocalize.t('cli.err.global_needs_project'));
    logError(vmzCliLocalize.t('cli.err.global_install_hint'));
    logError(vmzCliLocalize.t('cli.err.global_run_hint'));
    logError(vmzCliLocalize.t('cli.err.global_developer_hint'));
    return { action: 'exit', code: 1 };
}

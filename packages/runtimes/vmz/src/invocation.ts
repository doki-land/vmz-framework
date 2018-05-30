// @ts-nocheck
/**
 * `vmz` CLI invocation modes (JS gate only; Rust binary stays full).
 *
 * Three modes — do not collapse them:
 * - **developer**: monorepo source checkout (`packages/runtimes/vmz`, not under node_modules)
 * - **project**: app's `node_modules/vmz` or `node_modules/@vmz/vmz` (pnpm/npm/yarn)
 * - **global**: npm/pnpm global (or any install under node_modules that is not the nearest project one)
 *
 */

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'developer' | 'project' | 'global'} InvocationMode */

/**
 * Package root of the running `vmz` / `@vmz/vmz` install (`…/vmz`, not `…/vmz/dist`).
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
 * Walk from `startDir` for nearest project `vmz` / `@vmz/vmz` package root.
 * @param {string} startDir
 * @returns {string | null} realpath of package root
 */
export function findNearestProjectVmz(startDir) {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidates = [path.join(dir, 'node_modules', 'vmz'), path.join(dir, 'node_modules', '@vmz', 'vmz')];
        for (const candidate of candidates) {
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
 * Resolve CLI entry for a `vmz` package root (`bin/vmz.js`).
 * @param {string} packageRoot
 * @returns {string | null}
 */
export function resolveVmzBin(packageRoot) {
    const bin = path.join(packageRoot, 'bin', 'vmz.js');
    if (existsSync(bin)) return tryRealpath(bin);
    return null;
}

/**
 * Install lives under a `node_modules` tree (npm -g, pnpm store link, etc.).
 * Workspace source checkout (`packages/runtimes/vmz`) does not → developer mode.
 * @param {string} packageRoot
 */
export function isUnderNodeModules(packageRoot) {
    const norm = path.normalize(packageRoot);
    const parts = norm.split(path.sep);
    return parts.includes('node_modules');
}

/**
 * Classify how this process was launched.
 *
 * | mode | thisPackageRoot | rule |
 * |-------------|-----------------------------------------|-------------------------------------------|
 * | developer | monorepo `packages/runtimes/vmz` | not under `node_modules` |
 * | project | app `node_modules/(@vmz/)vmz` | under node_modules ∧ equals nearest |
 * | global | global / unrelated node_modules install | under node_modules ∧ not nearest project |
 *
 * @param {{
 * cwd?: string,
 * thisPackageRoot?: string,
 * }} [opts]
 * @returns {{
 * mode: InvocationMode,
 * cwd: string,
 * thisPackageRoot: string,
 * nearestProjectVmz: string | null,
 * isDeveloper: boolean,
 * isProjectLocal: boolean,
 * isGlobalLike: boolean,
 * }}
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
 * Commands allowed in **global** mode without re-exec / refusal.
 * Developer + project modes allow the full CLI.
 * @param {string | undefined} cmd
 */
export function isGlobalAllowedCommand(cmd) {
    if (!cmd) return true;
    return (
        cmd === 'help' ||
        cmd === '-h' ||
        cmd === '--help' ||
        cmd === 'version' ||
        cmd === '-V' ||
        cmd === '--version' ||
        cmd === 'new' ||
        cmd === 'init'
    );
}

/**
 * @param {string} bin
 * @param {string[]} argv full argv including command (e.g. `['check', '.']`)
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
 * Guard for project-only commands when the current install is **global** mode.
 * Developer / project → proceed. Global + local present → re-exec. Global alone → refuse.
 *
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
            logError('found project `@vmz/vmz` / `vmz` but bin/vmz.js is missing.');
            return { action: 'exit', code: 1 };
        }
        const code = await reexec(bin, argv);
        return { action: 'exit', code };
    }
    logError('this `vmz` is a global install (mode=global); project commands need a project install.');
    logError('Install in the app:  pnpm add -D @vmz/vmz');
    logError('Or scaffold:         vmz new <dir>');
    logError('Then run:            pnpm exec vmz <command>');
    logError('(developer mode: run from vmz-framework packages/runtimes/vmz source — full CLI)');
    return { action: 'exit', code: 1 };
}

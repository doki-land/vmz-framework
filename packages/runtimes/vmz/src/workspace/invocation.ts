/**
 * `vmz` CLI invocation modes (JS gate for `@vmz/vmz` only).
 *
 * Product install face: workspace `vmz` / publish `@vmz/vmz` (bin still `vmz`).
 *
 * Three modes — do not collapse them:
 * - **developer**: monorepo source checkout (`packages/runtimes/vmz`, not under node_modules)
 * - **project**: app's nearest `node_modules/vmz` or `node_modules/@vmz/vmz`
 * - **global**: npm/pnpm global (or any install under node_modules that is not the nearest project one)
 */

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vmzCliLocalize } from '../cli/cli-localize.js';

export type InvocationMode = 'developer' | 'project' | 'global';

const PROJECT_PKG_SEGMENTS = [['@vmz', 'vmz'], ['vmz']] as const;

/** Package root of the running `vmz` / `@vmz/vmz` install. */
export function resolveThisPackageRoot(fromUrl: string = import.meta.url): string {
    let dir = path.dirname(fileURLToPath(fromUrl));
    for (let depth = 0; depth < 8; depth++) {
        if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'bin', 'vmz.js'))) {
            return tryRealpath(dir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return path.resolve(path.dirname(fileURLToPath(fromUrl)), '..');
}

function tryRealpath(p: string): string {
    try {
        return realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/** Walk from `startDir` for nearest project CLI package root. */
export function findNearestProjectVmz(startDir: string): string | null {
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

/** Resolve CLI entry (`bin/vmz.js`). */
export function resolveVmzBin(packageRoot: string): string | null {
    const bin = path.join(packageRoot, 'bin', 'vmz.js');
    if (existsSync(bin)) return tryRealpath(bin);
    return null;
}

export function isUnderNodeModules(packageRoot: string): boolean {
    const norm = path.normalize(packageRoot);
    const parts = norm.split(path.sep);
    return parts.includes('node_modules');
}

export type InvocationContext = {
    mode: InvocationMode;
    cwd: string;
    thisPackageRoot: string;
    nearestProjectVmz: string | null;
    isDeveloper: boolean;
    isProjectLocal: boolean;
    /** @deprecated prefer `mode === 'global'`; kept for call sites */
    isGlobalLike: boolean;
};

export function getInvocationContext(opts: { cwd?: string; thisPackageRoot?: string } = {}): InvocationContext {
    const cwd = path.resolve(opts.cwd ?? process.cwd());
    const thisPackageRoot = tryRealpath(opts.thisPackageRoot ?? resolveThisPackageRoot());
    const nearestProjectVmz = findNearestProjectVmz(cwd);
    const underNm = isUnderNodeModules(thisPackageRoot);

    let mode: InvocationMode;
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
        isGlobalLike: mode === 'global',
    };
}

export function isGlobalAllowedCommand(cmd: string | undefined): boolean {
    if (!cmd) return true;
    return cmd === 'help' || cmd === '-h' || cmd === '--help' || cmd === 'version' || cmd === '-V' || cmd === '--version';
}

export function reexecProjectVmz(bin: string, argv: string[]): Promise<number> {
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

export type GateResult = { action: 'proceed' } | { action: 'exit'; code: number };

export async function gateGlobalProjectCommand(opts: {
    argv: string[];
    cwd?: string;
    thisPackageRoot?: string;
    reexec?: (bin: string, argv: string[]) => Promise<number>;
    logError?: (msg: string) => void;
}): Promise<GateResult> {
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

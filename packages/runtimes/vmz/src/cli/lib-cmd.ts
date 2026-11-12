/**
 * `vmz lib <package-dir>` — emit library artifacts for a package.
 *
 * Entry list comes from `package.json` `exports`: every subpath whose target is
 * a `.vmz` file becomes one artifact pair (`<Name>.js` + `<Name>.css`). No
 * entry is guessed: a package without `.vmz` exports fails explicitly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Cli, ParsedOptions } from '@vmz/commander';
import { log } from '../workspace/log.js';
import { runLibraryCompile } from '../workspace/library.js';
import type { LibraryCompileEntry } from '../workspace/library.js';

export function registerLibraryCommand(cli: Cli): void {
    cli.command('lib', 'cli.cmd.lib')
        .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
        .option('--release', 'cli.opt.release')
        .action((options) => cmdLibrary(options));
}

export function cmdLibrary(args: ParsedOptions): number {
    const dirArg = typeof args._[0] === 'string' ? args._[0] : '.';
    const packageDir = path.resolve(dirArg);
    const manifestPath = path.join(packageDir, 'package.json');
    let manifest: unknown;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        log.errorId('cli.err.lib_manifest', {
            path: manifestPath,
            detail: error instanceof Error ? error.message : String(error),
        });
        return 1;
    }
    const entries = collectEntries(packageDir, manifest);
    if (entries.length === 0) {
        log.errorId('cli.err.lib_no_entries', { path: manifestPath });
        return 1;
    }

    const outDir = path.resolve(
        packageDir,
        typeof args['out-dir'] === 'string' ? args['out-dir'] : 'dist',
    );
    log.info(`lib ${packageDir} → ${outDir} (${entries.length} entry)`);
    let result;
    try {
        result = runLibraryCompile({
            entries,
            outDir,
            release: Boolean(args.release),
        });
    } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
    const failing = log.diagnostics(result.diagnostics);
    if (!result.ok || failing > 0) {
        log.errorId('cli.err.lib_failed');
        return 1;
    }
    log.info(`lib ok (${result.emitted.length} file(s))`);
    return 0;
}

/**
 * Entry list: `vmz.library.entries` (name → source) is the authoritative form,
 * because a published package exports precompiled `dist` targets, not `.vmz`.
 * Packages that still export `.vmz` sources fall back to `exports`.
 */
function collectEntries(packageDir: string, manifest: unknown): LibraryCompileEntry[] {
    if (!manifest || typeof manifest !== 'object') return [];
    const entries = new Map<string, LibraryCompileEntry>();
    const declared = (manifest as { vmz?: { library?: { entries?: unknown } } }).vmz?.library?.entries;
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
        for (const [name, source] of Object.entries(declared as Record<string, unknown>)) {
            if (typeof source !== 'string' || !source.endsWith('.vmz')) continue;
            entries.set(name, { name, path: path.resolve(packageDir, source) });
        }
    }
    const exportsField = (manifest as { exports?: unknown }).exports;
    if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
        for (const [subpath, target] of Object.entries(exportsField as Record<string, unknown>)) {
            if (!subpath.startsWith('./')) continue;
            const targetPath = resolveTarget(target);
            if (!targetPath || !targetPath.endsWith('.vmz')) continue;
            const name = subpath.slice(2);
            if (!entries.has(name)) entries.set(name, { name, path: path.resolve(packageDir, targetPath) });
        }
    }
    return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function resolveTarget(target: unknown): string | null {
    if (typeof target === 'string') return target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
    const fallback = (target as { default?: unknown }).default;
    return typeof fallback === 'string' ? fallback : null;
}

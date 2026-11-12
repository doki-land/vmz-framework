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
 * `exports` → entry list. Only string targets and `{ default }` objects that
 * resolve to a `.vmz` file participate; subpath `"."` is skipped (a package
 * root export is not a single-file component contract).
 */
function collectEntries(packageDir: string, manifest: unknown): LibraryCompileEntry[] {
    if (!manifest || typeof manifest !== 'object') return [];
    const exportsField = (manifest as { exports?: unknown }).exports;
    if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return [];
    const entries: LibraryCompileEntry[] = [];
    for (const [subpath, target] of Object.entries(exportsField as Record<string, unknown>)) {
        if (!subpath.startsWith('./')) continue;
        const targetPath = resolveTarget(target);
        if (!targetPath || !targetPath.endsWith('.vmz')) continue;
        const name = subpath.slice(2);
        entries.push({ name, path: path.resolve(packageDir, targetPath) });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return entries;
}

function resolveTarget(target: unknown): string | null {
    if (typeof target === 'string') return target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
    const fallback = (target as { default?: unknown }).default;
    return typeof fallback === 'string' ? fallback : null;
}

/**
 * `vmz init` — materialize official presets into the application workspace.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { log } from '../workspace/log.js';
import { resolveWorkspaceDirs } from '../workspace/resolve.js';

export function registerInitCommands(parent: Command): void {
    parent
        .command('design', 'cli.cmd.init.design')
        .option('--preset <name>', 'cli.opt.init-preset')
        .option('--designs-dir <dir>', 'cli.opt.init-designs-dir')
        .option('--force', 'cli.opt.init-force')
        .option('--dry-run', 'cli.opt.init-dry-run')
        .action((options) => cmdInitDesign(options));
}

type ResolvedPreset = {
    id: string;
    root: string;
    files: string[];
};

/** Resolve `@vmz/ui/presets/<id>` from the project and read its `files` manifest. */
function resolvePreset(project: string, id: string): ResolvedPreset {
    const require = createRequire(path.join(project, 'package.json'));
    const manifestPath = require.resolve(`@vmz/ui/presets/${id}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        id?: string;
        files?: { root?: string; theme?: string; tokens?: string[]; themes?: string[] };
    };
    const files = [
        manifest.files?.theme,
        ...(manifest.files?.tokens ?? []),
        ...(manifest.files?.themes ?? []),
    ].filter((rel): rel is string => typeof rel === 'string' && rel.length > 0);
    if (!files.length) {
        throw new Error(`@vmz/ui/presets/${id} has no materialize files`);
    }
    // `presets/<id>.v0.json` sits next to the `presets/<id>/` directory.
    return { id: manifest.id ?? id, root: path.join(path.dirname(manifestPath), id), files };
}

function cmdInitDesign(args: ParsedOptions): number {
    const { project } = resolveWorkspaceDirs({ path: args._[0] ?? '.' });
    const presetId = typeof args.preset === 'string' && args.preset ? args.preset : 'web-surface';
    const force = args.force === true;
    const dryRun = args['dry-run'] === true;

    let preset: ResolvedPreset;
    try {
        preset = resolvePreset(project, presetId);
    } catch (error) {
        log.errorId('cli.err.init.preset', {
            preset: presetId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return 1;
    }

    const designsDir =
        typeof args['designs-dir'] === 'string' && args['designs-dir']
            ? path.resolve(project, args['designs-dir'])
            : path.join(project, 'designs');

    const created: string[] = [];
    const overwritten: string[] = [];
    const skipped: string[] = [];
    for (const rel of preset.files) {
        const source = path.join(preset.root, rel);
        const destination = path.join(designsDir, rel);
        const existed = existsSync(destination);
        if (existed && !force) {
            skipped.push(rel);
            continue;
        }
        if (!dryRun) {
            mkdirSync(path.dirname(destination), { recursive: true });
            writeFileSync(destination, readFileSync(source));
        }
        (existed ? overwritten : created).push(rel);
    }

    const prefix = dryRun ? 'init design (dry-run)' : 'init design';
    console.log(`${prefix}: preset=${preset.id} designs=${designsDir}`);
    for (const rel of created) console.log(`  create ${rel}`);
    for (const rel of overwritten) console.log(`  overwrite ${rel}`);
    for (const rel of skipped) console.log(`  skip ${rel}`);
    console.log(
        `${prefix}: created=${created.length} overwritten=${overwritten.length} skipped=${skipped.length}`,
    );
    return 0;
}

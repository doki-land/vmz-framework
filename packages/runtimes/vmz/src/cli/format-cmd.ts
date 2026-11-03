/**
 * `vmz format` — explicit-path formatter.
 *
 * Scope contract: the positional path is the whole scope. A file formats only
 * itself; a directory is walked locally. Nothing ever falls back to a
 * workspace-wide pass, and Rust runs per-file `rustfmt` — never `cargo fmt`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadNative } from '../workspace/public-api.js';
import { loadVmzConfig } from '../workspace/plugin-host.js';
import { log } from '../workspace/log.js';
import { resolveFormatConfig } from './format-config.js';

export type FormatCommandOptions = {
    /** Absolute explicit file or directory (already validated to exist). */
    target: string;
    /** Project root used to load `vmz.config` and the style config. */
    configRoot: string;
    check: boolean;
    overrides?: {
        javascript?: boolean;
        rust?: boolean;
        vmz?: boolean;
    };
};

export async function runFormatCommand(opts: FormatCommandOptions): Promise<number> {
    const { target, configRoot, check } = opts;
    const { format: formatConfig } = await loadVmzConfig(configRoot);
    const resolved = resolveFormatConfig(formatConfig);

    const native = loadNative();
    let report;
    try {
        report = native.formatTargetsRun({
            targets: [target],
            check,
            rust: opts.overrides?.rust,
            javascript: opts.overrides?.javascript,
            vmz: opts.overrides?.vmz,
            excludes: resolved.excludes,
            styleConfig: path.resolve(configRoot, resolved.style),
        });
    } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        return 1;
    }

    let exit = 0;
    for (const message of report.errors) {
        log.error(message);
    }
    if (report.errors.length > 0) exit = 1;
    if (log.diagnostics(report.diagnostics ?? [])) exit = 1;

    const scope = fs.statSync(target).isDirectory() ? `${target}${path.sep}` : target;
    if (check) {
        log.info(`format ${scope}: ${report.needWrite} file(s) would change, ${report.unchanged} unchanged`);
        if (report.needWrite > 0) exit = 1;
    } else {
        log.info(`format ${scope}: ${report.formatted} file(s) updated, ${report.unchanged} unchanged`);
    }
    return exit;
}

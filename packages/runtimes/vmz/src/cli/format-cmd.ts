/**
 * `vmz format` — workspace surfaces (JS/TS + Rust) + `.vmz` authoring formatter.
 */

import { loadNative } from '../workspace/public-api.js';
import { loadVmzConfig } from '../workspace/plugin-host.js';
import { log } from '../workspace/log.js';
import { resolveFormatConfig } from './format-config.js';

export type FormatCommandOptions = {
    project: string;
    outDir: string;
    check: boolean;
    overrides?: {
        javascript?: boolean;
        rust?: boolean;
        vmz?: boolean;
    };
    createWorkspace: (opts: { root: string; outDir: string }) => {
        format: (checkOnly?: boolean) => {
            filesChecked: number;
            filesWritten: number;
            filesNeedWrite: number;
            diagnostics?: Array<{ severity?: string }>;
        };
        dispose: () => void;
    };
};

export async function runFormatCommand(opts: FormatCommandOptions): Promise<number> {
    const { project, outDir, check, createWorkspace } = opts;
    const { format: formatConfig } = await loadVmzConfig(project);
    const resolved = resolveFormatConfig(project, formatConfig);
    if (opts.overrides?.javascript !== undefined) resolved.javascript = opts.overrides.javascript;
    if (opts.overrides?.rust !== undefined) resolved.rust = opts.overrides.rust;
    if (opts.overrides?.vmz !== undefined) resolved.vmz = opts.overrides.vmz;
    const native = loadNative();
    let exit = 0;

    if (resolved.javascript || resolved.rust) {
        const report = native.formatWorkspaceRun({
            cwd: project,
            check,
            includes: resolved.includes,
            excludes: resolved.excludes,
            rust: resolved.rust,
            javascript: resolved.javascript,
            styleConfig: resolved.style,
        });

        if (report.errors.length > 0) {
            for (const message of report.errors) {
                log.error(message);
            }
            exit = 1;
        } else if (check && report.formatted === 0 && report.unchanged > 0) {
            log.info(`workspace format: no changes needed (${report.unchanged} file(s) checked)`);
        } else if (!check) {
            log.info(`workspace format: ${report.formatted} file(s) updated, ${report.unchanged} unchanged`);
        }
    }

    if (resolved.vmz) {
        log.info(`format .vmz ${project}${check ? ' --check' : ''}`);
        const ws = createWorkspace({ root: project, outDir });
        try {
            const report = ws.format(check);
            const errors = log.diagnostics(report.diagnostics ?? []);
            if (check) {
                log.info(`checked ${report.filesChecked} .vmz file(s); ${report.filesNeedWrite} need write`);
                if (report.filesNeedWrite > 0) exit = 1;
            } else {
                log.info(`formatted ${report.filesWritten}/${report.filesChecked} .vmz file(s)`);
            }
            if (errors) exit = 1;
        } finally {
            ws.dispose();
        }
    }

    return exit;
}

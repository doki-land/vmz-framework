/**
 * Child process for one dev config build cycle.
 *
 * Evaluates `vmz.config.*`, applies plugin contributions into the workspace,
 * then writes a data-only report (no functions across the process boundary).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyPlugins, loadVmzConfig } from '../workspace/plugin-host.js';
import { createWorkspace } from '../workspace/public-api.js';

interface CycleInput {
    project: string;
    outDir: string;
}

function errorDetail(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause ? `: ${errorDetail(err.cause)}` : '';
    return `${message}${cause}`;
}

function writeReport(reportPath: string, report: unknown): void {
    let text: string;
    try {
        text = JSON.stringify(report, (_key, value) => (typeof value === 'function' ? undefined : value));
    } catch (err) {
        text = JSON.stringify({
            ok: false,
            configPath: null,
            pluginPath: null,
            plugins: [],
            engines: {},
            delivery: null,
            error: {
                code: 'vmz::config::load_failed',
                severity: 'error',
                args: { detail: `config report is not serializable: ${errorDetail(err)}` },
            },
        });
    }
    writeFileSync(reportPath, text);
}

const [inputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !reportPath) {
    process.stderr.write('config-cycle-worker: <input.json> <report.json> required\n');
    process.exit(2);
}
const input = JSON.parse(readFileSync(inputPath, 'utf8')) as CycleInput;
let ws: ReturnType<typeof createWorkspace> | null = null;

try {
    const cfg = await loadVmzConfig(input.project);
    ws = createWorkspace({ root: input.project, outDir: input.outDir });
    if (cfg.plugins.length) {
        await applyPlugins(ws, cfg.plugins, { project: input.project, outDir: input.outDir, engines: cfg.engines });
    }
    writeReport(reportPath, {
        ok: true,
        configPath: cfg.path,
        pluginPath: cfg.pluginPath,
        plugins: cfg.plugins.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            stages: p.manifest.stages ?? [],
        })),
        engines: cfg.engines,
        delivery: cfg.delivery ?? null,
    });
} catch (err) {
    const diagnostic = (err as { diagnostic?: unknown })?.diagnostic ?? {
        code: 'vmz::config::load_failed',
        severity: 'error',
        path: path.join(input.project, 'vmz.config.ts'),
        args: { detail: errorDetail(err) },
    };
    writeReport(reportPath, {
        ok: false,
        configPath: null,
        pluginPath: null,
        plugins: [],
        engines: {},
        delivery: null,
        error: diagnostic,
    });
} finally {
    ws?.dispose();
}

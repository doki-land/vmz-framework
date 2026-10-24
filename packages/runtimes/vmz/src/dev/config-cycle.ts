/**
 * Dev config build cycle.
 *
 * Each cycle runs config evaluation + plugin contribution in its own Node process.
 * Functions and plugin objects stay in that process; the parent receives data only.
 * Config/IPS changes restart the cycle: the old process is cancelled and awaited
 * before a new one may write plugin artifacts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ConfigCycleDiagnostic {
    code: string;
    severity?: 'error';
    path?: string;
    args?: Record<string, string>;
}

export interface ConfigCycleReport {
    ok: boolean;
    configPath: string | null;
    pluginPath: string | null;
    plugins: Array<{ name: string; version: string; stages: string[] }>;
    engines: Record<string, string>;
    delivery: unknown;
    error?: ConfigCycleDiagnostic;
}

export interface ConfigCycleOptions {
    project: string;
    outDir: string;
    /** Built worker (`dist/dev/config-cycle-worker.js`); defaults next to this module. */
    workerPath?: string;
    nodePath?: string;
    timeoutMs?: number;
}

export interface ConfigCycle {
    start(): Promise<ConfigCycleReport>;
    restart(): Promise<ConfigCycleReport>;
    cancel(): Promise<void>;
    running(): boolean;
}

export class ConfigCycleCancelledError extends Error {
    constructor() {
        super('vmz dev: config build process cancelled');
        this.name = 'ConfigCycleCancelledError';
    }
}

function defaultWorkerPath(): string {
    return fileURLToPath(new URL('./config-cycle-worker.js', import.meta.url));
}

function emptyReport(project: string, error?: ConfigCycleDiagnostic): ConfigCycleReport {
    return {
        ok: !error,
        configPath: null,
        pluginPath: null,
        plugins: [],
        engines: {},
        delivery: null,
        ...(error ? { error } : {}),
    };
}

function syntheticFailure(project: string, detail: string, configPath?: string): ConfigCycleReport {
    return emptyReport(project, {
        code: 'vmz::config::load_failed',
        severity: 'error',
        path: configPath ?? path.join(project, 'vmz.config.ts'),
        args: { detail },
    });
}

export function createConfigCycle(options: ConfigCycleOptions): ConfigCycle {
    const project = path.resolve(options.project);
    const outDir = path.resolve(options.outDir);
    const workerPath = options.workerPath ?? defaultWorkerPath();
    const nodePath = options.nodePath ?? process.env.VMZ_NODE ?? process.execPath;
    const timeoutMs = options.timeoutMs ?? 120_000;

    let child: ChildProcess | null = null;
    let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | null = null;
    let cancelled = false;

    async function cancel(): Promise<void> {
        if (!child) return;
        cancelled = true;
        const proc = child;
        const done = exited;
        try {
            proc.kill();
        } catch {
            /* already gone */
        }
        if (done) await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
        if (proc.exitCode == null && proc.signalCode == null) {
            try {
                proc.kill('SIGKILL');
            } catch {
                /* already gone */
            }
            if (done) await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
        }
    }

    async function start(): Promise<ConfigCycleReport> {
        if (child) throw new Error('vmz dev: config build process already running');
        if (!existsSync(workerPath)) {
            throw new Error(`vmz dev: missing config cycle worker ${workerPath} — run build:js`);
        }
        cancelled = false;
        const tmp = mkdtempSync(path.join(os.tmpdir(), 'vmz-config-cycle-'));
        const inputPath = path.join(tmp, 'input.json');
        const reportPath = path.join(tmp, 'report.json');
        writeFileSync(inputPath, JSON.stringify({ project, outDir }));

        let stderr = '';
        let timedOut = false;
        const proc = spawn(nodePath, [workerPath, inputPath, reportPath], {
            cwd: project,
            env: { ...process.env, VMZ_PROJECT_ROOT: project, VMZ_DIST: outDir },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        child = proc;
        proc.stderr?.on('data', (chunk: Buffer) => {
            if (stderr.length < 16_384) stderr += chunk.toString();
        });
        exited = new Promise((resolve) => {
            proc.once('exit', (code, signal) => resolve({ code, signal }));
        });
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                proc.kill();
            } catch {
                /* already gone */
            }
        }, timeoutMs);

        const result = await exited;
        clearTimeout(timer);
        child = null;
        exited = null;

        let report: ConfigCycleReport | null = null;
        if (!cancelled) {
            try {
                report = JSON.parse(readFileSync(reportPath, 'utf8')) as ConfigCycleReport;
            } catch {
                report = null;
            }
        }
        rmSync(tmp, { recursive: true, force: true });

        if (cancelled) throw new ConfigCycleCancelledError();
        if (!report) {
            const detail = timedOut
                ? `config build process timed out after ${timeoutMs}ms`
                : `config build process exited with code ${String(result.code)}${result.signal ? ` (${result.signal})` : ''}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(0, 4).join(' | ')}` : ''}`;
            return syntheticFailure(project, detail);
        }
        if (!report.ok && report.error) {
            if (!report.error.args?.detail && stderr.trim()) {
                report.error.args = { ...(report.error.args ?? {}), detail: stderr.trim().split('\n').slice(0, 4).join(' | ') };
            }
            return report;
        }
        return report;
    }

    async function restart(): Promise<ConfigCycleReport> {
        await cancel();
        return start();
    }

    return {
        start,
        restart,
        cancel,
        running: () => child != null,
    };
}

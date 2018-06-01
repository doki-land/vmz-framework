// @ts-nocheck
/**
 * Long-lived Node dev session (/session).
 *
 * Rebuilds go through the N-API `Workspace` — never spawn `cargo` / `vmz-tools`.
 * session: only dirty leaves are marked; Workspace emits affected deployment units.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildIntegratedDocuments, projectHasDocuments } from './document-integrate.js';
import { createWorkspace } from './index.js';
import { emitLocaleRuntimeModules, localeHasErrors } from './locale-check.js';
import { log } from './log.js';
import { diffFingerprints, fileFingerprintMap } from './watch-diff.js';

/**
 * @typedef {object} DevSessionOptions
 * @property {string} project
 * @property {string} outDir
 * @property {string} [host]
 * @property {number} [port]
 * @property {number} [pollMs]
 * @property {AbortSignal} [signal]
 * @property {typeof createWorkspace} [createWorkspaceFn]
 * @property {(opts: { project: string, outDir: string, host: string, port: number }) => import('node:child_process').ChildProcess} [spawnHostFn]
 * @property {(host: string, port: number, payload?: object) => Promise<void>} [softReloadFn]
 */

/**
 * @param {DevSessionOptions} options
 */
export function createDevSession(options) {
    const project = options.project;
    const outDir = options.outDir;
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 5173;
    const pollMs = Math.max(50, options.pollMs ?? 300);
    const createWs = options.createWorkspaceFn ?? createWorkspace;
    const spawnHost = options.spawnHostFn ?? defaultSpawnHost;
    const softReload = options.softReloadFn ?? defaultSoftReload;

    const ws = createWs({ root: project, outDir });
    /** @type {import('node:child_process').ChildProcess | null} */
    let child = null;
    let stopped = false;

    /**
     * @param {Array<{ path: string, kind: 'update' | 'delete' }>} [changes]
     */
    function rebuild(changes) {
        if (changes?.length) ws.updateFiles(changes);
        return ws.build();
    }

    function emitLocales() {
        const localeEmit = emitLocaleRuntimeModules(project, outDir);
        if (!localeEmit.ok || localeHasErrors({ diagnostics: localeEmit.diagnostics })) {
            log.diagnostics(localeEmit.diagnostics ?? []);
            log.error('locale runtime emit failed');
            return false;
        }
        return true;
    }

    function printReport(report, label) {
        const errors = log.diagnostics(report.diagnostics ?? []);
        if (errors) {
            log.error(`${label} failed (${errors} error(s))`);
            return false;
        }
        if (!emitLocales()) return false;
        const mode = report.full ? 'full' : 'affected';
        const chunks = (report.affectedChunks || []).join(', ') || '(none)';
        log.info(`${label} ok (${mode}; chunks=[${chunks}]; ${(report.emitted ?? []).length} emitted)`);
        return true;
    }

    async function start() {
        const src = path.join(project, 'src');
        if (!existsSync(src)) {
            throw new Error(`vmz dev: missing src/ under ${project}`);
        }

        log.info('initial build (N-API workspace, full)…');
        // Empty dirty → full project build (session).
        const initial = rebuild();
        if (!printReport(initial, 'build')) {
            throw new Error('vmz dev: initial build failed');
        }

        if (projectHasDocuments(project)) {
            const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
            if (!docs.ok) {
                throw new Error('vmz dev: integrated document build failed');
            }
        }

        const hostJs = path.join(outDir, 'vmz-serve-host.mjs');
        if (!existsSync(hostJs)) {
            throw new Error(`vmz dev: missing ${hostJs}`);
        }

        child = spawnHost({ project, outDir, host, port });
        const docsRoot = path.join(project, 'documents');
        const localesRoot = path.join(project, 'locales');
        const watchRoots = [src].concat(existsSync(docsRoot) ? [docsRoot] : []).concat(existsSync(localesRoot) ? [localesRoot] : []);
        log.info(`dev → http://${host}:${port} (watching ${watchRoots.join(', ')})`);

        /** @type {Map<string, Map<string, string>>} */
        let fingerprints = new Map();
        for (const root of watchRoots) {
            fingerprints.set(root, fileFingerprintMap(root));
        }
        const signal = options.signal;

        const onAbort = () => {
            void stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
            while (!stopped && !signal?.aborted) {
                await sleep(pollMs);
                if (stopped || signal?.aborted) break;

                if (child && child.exitCode != null) {
                    log.warn(`serve-host exited (${child.exitCode}) — respawning…`);
                    child = spawnHost({ project, outDir, host, port });
                    continue;
                }

                /** @type {{ srcChanged: string[], srcDeleted: string[], docsDirty: boolean, localesDirty: boolean }} */
                let batch = { srcChanged: [], srcDeleted: [], docsDirty: false, localesDirty: false };
                try {
                    // Probe only — keep prior fingerprints until debounce resample
                    // (same contract as pre-docs watcher: empty second pass would miss soft reload).
                    for (const root of watchRoots) {
                        const prev = fingerprints.get(root) || new Map();
                        const next = fileFingerprintMap(root);
                        const diff = diffFingerprints(prev, next);
                        if (root === src) {
                            batch.srcChanged = diff.changed;
                            batch.srcDeleted = diff.deleted;
                        } else if (root === localesRoot) {
                            if (diff.changed.length || diff.deleted.length) batch.localesDirty = true;
                        } else if (diff.changed.length || diff.deleted.length) {
                            batch.docsDirty = true;
                        }
                    }
                } catch (err) {
                    log.warn('watch error:', err);
                    continue;
                }
                if (!batch.srcChanged.length && !batch.srcDeleted.length && !batch.docsDirty && !batch.localesDirty) continue;

                await sleep(200);
                // Resample against the same prior fingerprints, then commit.
                batch = { srcChanged: [], srcDeleted: [], docsDirty: false, localesDirty: false };
                for (const root of watchRoots) {
                    const prev = fingerprints.get(root) || new Map();
                    const next = fileFingerprintMap(root);
                    const diff = diffFingerprints(prev, next);
                    fingerprints.set(root, next);
                    if (root === src) {
                        batch.srcChanged = diff.changed;
                        batch.srcDeleted = diff.deleted;
                    } else if (root === localesRoot) {
                        if (diff.changed.length || diff.deleted.length) batch.localesDirty = true;
                    } else if (diff.changed.length || diff.deleted.length) {
                        batch.docsDirty = true;
                    }
                }
                if (!batch.srcChanged.length && !batch.srcDeleted.length && !batch.docsDirty && !batch.localesDirty) continue;

                let needFullReload = batch.docsDirty;
                if (batch.srcChanged.length || batch.srcDeleted.length) {
                    log.info(`change detected (${batch.srcChanged.length} update, ${batch.srcDeleted.length} delete) — affected rebuild…`);
                    const changes = [
                        ...batch.srcChanged.map((p) => ({ path: p, kind: /** @type {'update'} */ ('update') })),
                        ...batch.srcDeleted.map((p) => ({ path: p, kind: /** @type {'delete'} */ ('delete') })),
                    ];
                    const report = rebuild(changes);
                    if (!printReport(report, 'rebuild')) {
                        log.warn('rebuild failed — keeping previous server');
                        continue;
                    }
                    if (batch.docsDirty || projectHasDocuments(project)) {
                        // App rebuild may refresh designs CSS consumed by documents.
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                        if (!docs.ok) {
                            log.warn('document mount rebuild failed — keeping previous docs');
                        } else {
                            needFullReload = true;
                        }
                    }
                    try {
                        await softReload(host, port, {
                            affectedChunks: report.affectedChunks ?? [],
                            seedChunks: report.seedChunks ?? [],
                            full: Boolean(report.full) || needFullReload,
                            islandHmr: Boolean(report.islandHmr) && !needFullReload,
                        });
                        log.info(
                            needFullReload
                                ? 'soft reload ok (full page; docs)'
                                : report.islandHmr
                                  ? 'soft reload ok (island HMR)'
                                  : 'soft reload ok (full page)',
                        );
                    } catch (err) {
                        log.warn(`soft reload failed (${err}) — keeping previous serve-host (fix and save)`);
                    }
                    continue;
                }

                if (batch.localesDirty) {
                    log.info('locales change detected — re-emitting #locales runtime…');
                    if (!emitLocales()) {
                        log.warn('locale runtime emit failed — keeping previous modules');
                        continue;
                    }
                    try {
                        await softReload(host, port, { full: true, islandHmr: false });
                        log.info('soft reload ok (full page; locales)');
                    } catch (err) {
                        log.warn(`soft reload failed (${err}) — keeping previous serve-host (fix and save)`);
                    }
                    if (!batch.docsDirty) continue;
                }

                if (batch.docsDirty) {
                    log.info('documents change detected — rebuilding document mount…');
                    const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                    if (!docs.ok) {
                        log.warn('document mount rebuild failed — keeping previous docs');
                        continue;
                    }
                    try {
                        await softReload(host, port, { full: true, islandHmr: false });
                        log.info('soft reload ok (full page; docs)');
                    } catch (err) {
                        log.warn(`soft reload failed (${err}) — keeping previous serve-host (fix and save)`);
                    }
                }
            }
        } finally {
            signal?.removeEventListener('abort', onAbort);
            await stop();
        }
    }

    async function stop() {
        if (stopped) return;
        stopped = true;
        killChild(child);
        child = null;
        try {
            ws.dispose();
        } catch {
            /* ignore */
        }
    }

    return { ws, rebuild, start, stop, project, outDir, host, port };
}

/** @deprecated use fileFingerprintMap */
export function srcFingerprint(srcDir) {
    const map = fileFingerprintMap(srcDir);
    let h = 0xcbf29ce484222325n;
    const keys = [...map.keys()].sort();
    for (const k of keys) {
        for (const b of Buffer.from(`${k}|${map.get(k)}`)) {
            h = (h * 0x100000001b3n + BigInt(b)) & 0xffffffffffffffffn;
        }
    }
    return Number(h & 0xffffffffffffffffn);
}

/** @deprecated */
export function listWatchedFiles(srcDir) {
    return [...fileFingerprintMap(srcDir).keys()];
}

function defaultSpawnHost(opts) {
    const hostJs = path.join(opts.outDir, 'vmz-serve-host.mjs');
    const node = process.env.VMZ_NODE || process.execPath;
    return spawn(node, [hostJs], {
        cwd: opts.project,
        env: {
            ...process.env,
            VMZ_DIST: opts.outDir,
            VMZ_PORT: String(opts.port),
            VMZ_HOST: opts.host,
            VMZ_DEV: '1',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
    });
}

/**
 * @param {string} host
 * @param {number} port
 * @param {object} [payload]
 */
async function defaultSoftReload(host, port, payload = {}) {
    const url = `http://${host}:${port}/__vmz/reload`;
    const body = JSON.stringify(payload);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    if (!json?.ok) throw new Error(JSON.stringify(json));
}

function killChild(child) {
    if (!child || child.killed) return;
    try {
        child.kill();
    } catch {
        /* ignore */
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

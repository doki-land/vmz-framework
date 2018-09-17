// @ts-nocheck
/**
 * Long-lived Node dev session (/session).
 *
 * Rebuilds go through the N-API `Workspace` — never spawn `cargo` / `vmz-tools`.
 * session: only dirty leaves are marked; Workspace emits affected deployment units.
 *
 * Reload policy (Vite-like — author never hand-restarts):
 * 1. Prefer in-process soft reload (`POST /__vmz/reload`) with transitive `?t=` via serve-host hook.
 * 2. Soft reload only re-imports affected pages unless shared `lib/` / full rebuild.
 * 3. Soft reload failure → **auto-respawn** serve-host (fresh ESM graph), not "keep broken host".
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildIntegratedDocuments, projectHasDocuments } from './document-integrate.js';
import { createWorkspace, resolveNativePath } from './index.js';
import { emitLocaleRuntimeModules, localeHasErrors } from './locale-check.js';
import { log } from './log.js';
import { coalesceRootBurst, collectDevWatchRoots, classifyWatchRoot, isDependencyPath, mergeDirtySets } from './dev-watch-roots.js';
import { diffFingerprints, fileFingerprintMap } from './watch-diff.js';

/**
 * @typedef {object} DevSessionOptions
 * @property {string} project
 * @property {string} outDir
 * @property {string} [host]
 * @property {number} [port]
 * @property {number} [pollMs]
 * @property {'browser' | 'mini-program-wechat'} [target]
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
    const wechatPreview = options.target === 'mini-program-wechat';
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
        log.diagnostics(localeEmit.diagnostics ?? []);
        if (!localeEmit.ok || localeHasErrors({ diagnostics: localeEmit.diagnostics })) {
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

    /**
     * Rewrite `dist/wechat` so WeChat DevTools (already open) recompiles WXSS.
     * Preview is vendor compile, not the browser serve-host.
     */
    function packWechatPreview() {
        if (typeof ws.lowerMiniprogramWechatPackaging !== 'function') {
            log.error('wechat pack: workspace missing lowerMiniprogramWechatPackaging');
            return false;
        }
        let report;
        try {
            const raw = ws.lowerMiniprogramWechatPackaging();
            report = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (err) {
            log.error(`wechat pack failed: ${err}`);
            return false;
        }
        log.diagnostics(report.diagnostics ?? []);
        if (report.status !== 'ready') {
            log.error(`wechat pack ${report.status || 'failed'}`);
            return false;
        }
        const packRoot = report.packRoot || 'dist/wechat';
        log.info(`wechat pack ok → ${path.join(project, packRoot)} (WeChat DevTools compiles WXSS here)`);
        return true;
    }

    async function waitHostReady(timeoutMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const res = await fetch(`http://${host}:${port}/__vmz/ready`);
                if (res.ok) return;
            } catch {
                /* not up yet */
            }
            await sleep(50);
        }
        throw new Error(`serve-host not ready on ${host}:${port}`);
    }

    async function waitHostGone(timeoutMs = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                await fetch(`http://${host}:${port}/__vmz/health`);
                await sleep(40);
            } catch {
                return;
            }
        }
    }

    async function respawnHost(reason) {
        log.warn(`respawning serve-host (${reason})…`);
        killChild(child);
        child = null;
        await waitHostGone();
        child = spawnHost({ project, outDir, host, port });
        await waitHostReady();
        log.info('serve-host respawned — browser SSE will reconnect and reload');
    }

    /**
     * Soft reload first; on failure auto-respawn so authors never hand-restart.
     * @param {object} payload
     */
    async function reloadAfterBuild(payload) {
        try {
            await softReload(host, port, payload);
            return 'soft';
        } catch (err) {
            log.warn(`soft reload failed (${err}) — auto-respawning serve-host`);
            await respawnHost('soft-reload-failed');
            return 'respawn';
        }
    }

    async function start() {
        const src = path.join(project, 'src');
        if (!existsSync(src)) {
            throw new Error(`vmz dev: missing src/ under ${project}`);
        }

        log.info('initial build (N-API workspace, full)…');
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

        if (wechatPreview) {
            if (!packWechatPreview()) {
                throw new Error('vmz dev: wechat pack failed');
            }
        } else {
            const hostJs = path.join(outDir, 'vmz-serve-host.mjs');
            if (!existsSync(hostJs)) {
                throw new Error(`vmz dev: missing ${hostJs}`);
            }

            child = spawnHost({ project, outDir, host, port });
            await waitHostReady().catch((err) => {
                log.warn(String(err));
            });
        }
        const docsRoot = path.join(project, 'documents');
        const localesRoot = path.join(project, 'locales');
        const designsRoot = path.join(project, 'designs');
        const watched = collectDevWatchRoots({ project, outDir });
        /** @type {string[]} */
        const watchRoots = [...watched.roots];
        /** @type {string[]} */
        let dependencyRoots = [...watched.dependencyRoots];
        if (wechatPreview) {
            log.info(`dev → WeChat DevTools (watching ${watchRoots.join(', ')}; keep dist/wechat open)`);
        } else {
            log.info(`dev → http://${host}:${port} (watching ${watchRoots.join(', ')})`);
        }
        if (dependencyRoots.length) {
            log.info(`dev dependency watch roots (${dependencyRoots.length}): ${dependencyRoots.join(', ')}`);
        }

        /** @type {Map<string, Map<string, string>>} */
        const fingerprints = new Map();
        for (const root of watchRoots) {
            fingerprints.set(root, fileFingerprintMap(root));
        }
        const signal = options.signal;

        const onAbort = () => {
            void stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        /**
         * Scan all watch roots into a batch. Does not update fingerprints.
         */
        function scanBatch() {
            /** @type {{ srcChanged: string[], srcDeleted: string[], depChanged: string[], depDeleted: string[], designsChanged: string[], designsDeleted: string[], docsDirty: boolean, localesDirty: boolean, designsDirty: boolean }} */
            const batch = {
                srcChanged: [],
                srcDeleted: [],
                depChanged: [],
                depDeleted: [],
                designsChanged: [],
                designsDeleted: [],
                docsDirty: false,
                localesDirty: false,
                designsDirty: false,
            };
            const watchCtx = { src, docsRoot, localesRoot, designsRoot, dependencyRoots };
            for (const root of watchRoots) {
                const prev = fingerprints.get(root) || new Map();
                const next = fileFingerprintMap(root);
                const diff = diffFingerprints(prev, next);
                if (!diff.changed.length && !diff.deleted.length) continue;
                const kind = classifyWatchRoot(root, watchCtx);
                if (kind === 'src') {
                    batch.srcChanged.push(...diff.changed);
                    batch.srcDeleted.push(...diff.deleted);
                } else if (kind === 'locales') {
                    batch.localesDirty = true;
                } else if (kind === 'docs') {
                    batch.docsDirty = true;
                } else if (kind === 'designs') {
                    batch.designsDirty = true;
                    batch.designsChanged.push(...diff.changed);
                    batch.designsDeleted.push(...diff.deleted);
                } else if (kind === 'dep') {
                    batch.depChanged.push(...diff.changed);
                    batch.depDeleted.push(...diff.deleted);
                } else {
                    batch.docsDirty = true;
                }
            }
            return batch;
        }

        function commitFingerprints() {
            for (const root of watchRoots) {
                fingerprints.set(root, fileFingerprintMap(root));
            }
        }

        try {
            while (!stopped && !signal?.aborted) {
                await sleep(pollMs);
                if (stopped || signal?.aborted) break;

                if (!wechatPreview && child && child.exitCode != null) {
                    log.warn(`serve-host exited (${child.exitCode}) — respawning…`);
                    child = spawnHost({ project, outDir, host, port });
                    await waitHostReady().catch(() => {});
                    continue;
                }

                let batch;
                try {
                    batch = scanBatch();
                } catch (err) {
                    log.warn('watch error:', err);
                    continue;
                }
                const srcDirty = batch.srcChanged.length + batch.srcDeleted.length;
                const depDirty = batch.depChanged.length + batch.depDeleted.length;
                const designsDirty = batch.designsDirty || batch.designsChanged.length + batch.designsDeleted.length;
                if (!srcDirty && !depDirty && !batch.docsDirty && !batch.localesDirty && !designsDirty) continue;

                // Coalesce multi-file bursts without dropping the initial dirty set.
                if (srcDirty > 1) {
                    const coalesced = await coalesceRootBurst(src, fingerprints, {
                        changed: batch.srcChanged,
                        deleted: batch.srcDeleted,
                    });
                    batch.srcChanged = coalesced.changed;
                    batch.srcDeleted = coalesced.deleted;
                }
                if (depDirty > 1) {
                    // Coalesce each dirty dependency root independently, then merge.
                    /** @type {{ changed: string[], deleted: string[] }} */
                    let acc = { changed: [...batch.depChanged], deleted: [...batch.depDeleted] };
                    for (const root of dependencyRoots) {
                        const prev = fingerprints.get(root) || new Map();
                        const next = fileFingerprintMap(root);
                        const peek = diffFingerprints(prev, next);
                        if (peek.changed.length + peek.deleted.length <= 1 && !acc.changed.some((f) => isDependencyPath(f, [root]))) {
                            continue;
                        }
                        const coalesced = await coalesceRootBurst(root, fingerprints, {
                            changed: acc.changed.filter((f) => isDependencyPath(f, [root])),
                            deleted: acc.deleted.filter((f) => isDependencyPath(f, [root])),
                        });
                        const others = {
                            changed: acc.changed.filter((f) => !isDependencyPath(f, [root])),
                            deleted: acc.deleted.filter((f) => !isDependencyPath(f, [root])),
                        };
                        acc = mergeDirtySets(others, coalesced);
                    }
                    batch.depChanged = acc.changed;
                    batch.depDeleted = acc.deleted;
                } else if (srcDirty === 1 || depDirty === 1) {
                    await sleep(200);
                }

                // Refresh residual dirty after settle (without discarding coalesced sets).
                const residual = scanBatch();
                {
                    const srcMerged = mergeDirtySets(
                        { changed: batch.srcChanged, deleted: batch.srcDeleted },
                        { changed: residual.srcChanged, deleted: residual.srcDeleted },
                    );
                    batch.srcChanged = srcMerged.changed;
                    batch.srcDeleted = srcMerged.deleted;
                    const depMerged = mergeDirtySets(
                        { changed: batch.depChanged, deleted: batch.depDeleted },
                        { changed: residual.depChanged, deleted: residual.depDeleted },
                    );
                    batch.depChanged = depMerged.changed;
                    batch.depDeleted = depMerged.deleted;
                    batch.docsDirty = batch.docsDirty || residual.docsDirty;
                    batch.localesDirty = batch.localesDirty || residual.localesDirty;
                    batch.designsDirty = batch.designsDirty || residual.designsDirty;
                    const designsMerged = mergeDirtySets(
                        { changed: batch.designsChanged, deleted: batch.designsDeleted },
                        { changed: residual.designsChanged, deleted: residual.designsDeleted },
                    );
                    batch.designsChanged = designsMerged.changed;
                    batch.designsDeleted = designsMerged.deleted;
                }

                commitFingerprints();

                if (
                    !batch.srcChanged.length &&
                    !batch.srcDeleted.length &&
                    !batch.depChanged.length &&
                    !batch.depDeleted.length &&
                    !batch.docsDirty &&
                    !batch.localesDirty &&
                    !(batch.designsDirty || batch.designsChanged.length || batch.designsDeleted.length)
                ) {
                    continue;
                }

                // Dependency changes: conservative full rebuild + full reload (v0.1.5).
                if (batch.depChanged.length || batch.depDeleted.length) {
                    log.info(
                        `dependency change detected (${batch.depChanged.length} update, ${batch.depDeleted.length} delete) — full rebuild…`,
                    );
                    const report = rebuild();
                    if (!printReport(report, 'rebuild')) {
                        log.warn('rebuild failed — keeping previous server');
                        continue;
                    }
                    // Refresh watch roots in case the graph gained new packages.
                    const refreshed = collectDevWatchRoots({ project, outDir });
                    for (const r of refreshed.roots) {
                        if (!watchRoots.includes(r)) {
                            watchRoots.push(r);
                            fingerprints.set(r, fileFingerprintMap(r));
                        }
                    }
                    dependencyRoots = [...refreshed.dependencyRoots];

                    if (batch.docsDirty || projectHasDocuments(project)) {
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                        if (!docs.ok) log.warn('document mount rebuild failed — keeping previous docs');
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) log.warn('wechat pack failed — keeping previous dist/wechat');
                        continue;
                    }
                    const kind = await reloadAfterBuild({
                        affectedChunks: report.affectedChunks ?? [],
                        seedChunks: report.seedChunks ?? [],
                        emitted: report.emitted ?? [],
                        full: true,
                        islandHmr: false,
                    });
                    log.info(kind === 'respawn' ? 'reload ok (respawned; deps)' : 'soft reload ok (full page; deps)');
                    continue;
                }

                let needFullReload = batch.docsDirty || batch.designsDirty;
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
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                        if (!docs.ok) {
                            log.warn('document mount rebuild failed — keeping previous docs');
                        } else {
                            needFullReload = true;
                        }
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) {
                            log.warn('wechat pack failed — keeping previous dist/wechat');
                        }
                        continue;
                    }
                    const kind = await reloadAfterBuild({
                        affectedChunks: report.affectedChunks ?? [],
                        seedChunks: report.seedChunks ?? [],
                        emitted: report.emitted ?? [],
                        full: Boolean(report.full) || needFullReload,
                        islandHmr: Boolean(report.islandHmr) && !needFullReload,
                    });
                    log.info(
                        kind === 'respawn'
                            ? 'reload ok (respawned serve-host)'
                            : needFullReload
                              ? 'soft reload ok (full page; docs)'
                              : report.islandHmr
                                ? 'soft reload ok (island HMR)'
                                : 'soft reload ok',
                    );
                    continue;
                }

                if (batch.designsChanged.length || batch.designsDeleted.length || batch.designsDirty) {
                    log.info(
                        `designs change detected (${batch.designsChanged.length} update, ${batch.designsDeleted.length} delete) — rebuilding styles…`,
                    );
                    const changes = [
                        ...batch.designsChanged.map((p) => ({ path: p, kind: /** @type {'update'} */ ('update') })),
                        ...batch.designsDeleted.map((p) => ({ path: p, kind: /** @type {'delete'} */ ('delete') })),
                    ];
                    const report = rebuild(changes.length ? changes : undefined);
                    if (!printReport(report, 'rebuild')) {
                        log.warn('designs rebuild failed — keeping previous styles');
                        continue;
                    }
                    if (batch.docsDirty || projectHasDocuments(project)) {
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                        if (!docs.ok) log.warn('document mount rebuild failed — keeping previous docs');
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) log.warn('wechat pack failed — keeping previous dist/wechat');
                        continue;
                    }
                    const kind = await reloadAfterBuild({
                        affectedChunks: report.affectedChunks ?? [],
                        seedChunks: report.seedChunks ?? [],
                        emitted: report.emitted ?? [],
                        full: true,
                        islandHmr: false,
                    });
                    log.info(kind === 'respawn' ? 'reload ok (respawned; designs)' : 'soft reload ok (full page; designs)');
                    continue;
                }

                if (batch.localesDirty) {
                    log.info('locales change detected — re-emitting #locales runtime…');
                    if (!emitLocales()) {
                        log.warn('locale runtime emit failed — keeping previous modules');
                        continue;
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) {
                            log.warn('wechat pack failed — keeping previous dist/wechat');
                        }
                        if (!batch.docsDirty) continue;
                    } else {
                        const kind = await reloadAfterBuild({ full: true, islandHmr: false, emitted: [] });
                        log.info(kind === 'respawn' ? 'reload ok (respawned; locales)' : 'soft reload ok (full page; locales)');
                        if (!batch.docsDirty) continue;
                    }
                }

                if (batch.docsDirty) {
                    log.info('documents change detected — rebuilding document mount…');
                    const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
                    if (!docs.ok) {
                        log.warn('document mount rebuild failed — keeping previous docs');
                        continue;
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) {
                            log.warn('wechat pack failed — keeping previous dist/wechat');
                        }
                    } else {
                        const kind = await reloadAfterBuild({ full: true, islandHmr: false, emitted: [] });
                        log.info(kind === 'respawn' ? 'reload ok (respawned; docs)' : 'soft reload ok (full page; docs)');
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
            VMZ_PROJECT_ROOT: opts.project,
            VMZ_NATIVE_NODE: resolveNativePath(),
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

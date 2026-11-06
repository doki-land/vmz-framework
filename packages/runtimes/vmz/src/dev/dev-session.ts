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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildIntegratedDocuments, projectHasDocuments } from '../document/document-integrate.js';
import { createWorkspace, resolveNativePath } from '../workspace/public-api.js';
import { loadVmzConfig } from '../workspace/plugin-host.js';
import { materializeWechatPackaging } from '../workspace/wechat-packaging.js';
import { emitLocaleRuntimeModules, localeHasErrors } from '../locale/locale-check.js';
import { log } from '../workspace/log.js';
import {
    coalesceRootBurst,
    collectDevWatchRoots,
    classifyWatchRoot,
    isDependencyPath,
    mergeDirtySets,
    collectConfigDependencies,
    configCandidatePaths,
    configFingerprintMap,
} from './dev-watch-roots.js';
import { createConfigCycle, type ConfigCycle, type ConfigCycleReport } from './config-cycle.js';
import {
    buildReloadPayload,
    filterGenerationIgnore,
    parseHmrPlan,
    registerWrittenOutputsIgnore,
    shouldSoftReload,
    staticRevisionFromArtifact,
} from './dev-incremental.js';
import { diffFingerprints, fileFingerprintMap } from '../workspace/watch-diff.js';
import { packFromDeploymentIr, deploymentUnitOrigins } from '../workspace/pack.js';
import { loadDeploymentIr } from '../workspace/bundler-adapter.js';

/** Track serve-host so a failed/killed launcher cannot leave an orphan port. */
const DEV_HOST_PID = '.vmz-dev-host.pid';

interface DevSessionOptions {
    project: string;
    outDir: string;
    host?: string;
    port?: number;
    pollMs?: number;
    target?: 'browser' | 'mini-program-wechat';
    /** Delivery snapshot evaluated by the config host; the package contract is prepared from it. */
    delivery?: unknown;
    signal?: AbortSignal;
    createWorkspaceFn?: typeof createWorkspace;
    spawnHostFn?: (opts: { project: string; outDir: string; host: string; port: number }) => import('node:child_process').ChildProcess;
    softReloadFn?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
    /** Test seam for the browser pack stage (defaults to `packFromDeploymentIr`). */
    packFn?: typeof packFromDeploymentIr;
    /** Override the detached config build process (tests). */
    configCycleFn?: (opts: { project: string; outDir: string; workerPath?: string }) => ConfigCycle;
    /** Built config cycle worker path (defaults to `dist/dev/config-cycle-worker.js`). */
    configCycleWorkerPath?: string;
}

function cycleFailure(report: ConfigCycleReport): Error {
    const detail = report.error?.args?.detail ?? 'config build process failed';
    const error = new Error(detail);
    return report.error ? Object.assign(error, { diagnostic: report.error }) : error;
}

/**
 * Pack 输入快照：dev 只在「决定产物字节的全部输入」完全不变时才复用上次产物。
 * 判据是文件内容哈希，不使用 mtime、文件数量或后缀推导；读不到或未知的输入一律按变更处理。
 */
const PACK_INPUT_IGNORED_DIRS = new Set(['_vmz', 'node_modules', '.cache', '.git']);
const PACK_INPUT_IGNORED_NAMES = /^\.vmz-dev-host\.pid$/;

export interface PackManifestView {
    chunks?: Array<{ fileName?: string; sourceMap?: string; modules?: unknown[] }>;
    styles?: Array<{ fileName?: string; sourcePaths?: unknown[] }>;
    assets?: Array<{ fileName?: string }>;
    entryFiles?: Array<{ file?: string }>;
    dynamicFiles?: Array<{ from?: string; to?: string }>;
    unitChunks?: Array<{ fileName?: string | null }>;
}

export interface PackInputSnapshot {
    files: Array<{ path: string; digest: string }>;
    listings: Array<{ dir: string; names: string[] }>;
    deploymentOrigins: string;
    lockfile: { path: string; digest: string };
    manifest: { path: string; digest: string };
}

/** Rust 侧的模块路径带 `//?/`（或 `\\?\`）verbatim 前缀，落盘读取前需要剥离。 */
function packInputFsPath(filePath: string): string {
    return filePath.replace(/^(?:\\\\\?\\|\/\/\?\/)/, '').replace(/\\/g, '/');
}

function readFileDigest(filePath: string): string | null {
    try {
        return createHash('sha256').update(readFileSync(filePath)).digest('hex');
    } catch {
        return null;
    }
}

function findLockfile(project: string): string | null {
    let dir = path.resolve(project);
    while (true) {
        const candidate = path.join(dir, 'pnpm-lock.yaml');
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function listPackInputDir(dir: string): string[] | null {
    const names: string[] = [];
    const walk = (current: string, prefix: string): boolean => {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return false;
        }
        entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        for (const entry of entries) {
            if (PACK_INPUT_IGNORED_DIRS.has(entry.name) || PACK_INPUT_IGNORED_NAMES.test(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!walk(path.join(current, entry.name), rel)) return false;
            } else {
                names.push(rel);
            }
        }
        return true;
    };
    return walk(dir, '') ? names : null;
}

/** manifest 形状不认识时返回 null（而非空集合），避免把未知输入当成「没变化」。 */
function packInputFiles(manifest: PackManifestView): string[] | null {
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) return null;
    const files = new Set<string>();
    for (const chunk of manifest.chunks) {
        if (!Array.isArray(chunk.modules)) return null;
        for (const module of chunk.modules) {
            if (typeof module !== 'string' || !module) return null;
            files.add(packInputFsPath(module));
        }
    }
    if (!Array.isArray(manifest.styles)) return null;
    for (const style of manifest.styles) {
        if (!Array.isArray(style.sourcePaths)) return null;
        for (const source of style.sourcePaths) {
            if (typeof source !== 'string' || !source) return null;
            files.add(packInputFsPath(source));
        }
    }
    return [...files].sort();
}

/** pack 只经 `deploymentUnitOrigins` 读取 IR；对这份 origins 取规范摘要，避免把构建期 affected/seed 噪声算成输入变更。 */
function deploymentOriginsDigest(outDir: string): string | null {
    try {
        const origins = deploymentUnitOrigins(outDir, loadDeploymentIr(outDir));
        const canonical = Object.keys(origins)
            .sort()
            .map((key) => `${key}\u0000${origins[key]}`);
        return createHash('sha256').update(canonical.join('\u0001')).digest('hex');
    } catch {
        return null;
    }
}

/** 记下决定 pack 产物的全部输入；任何一项取不到就放弃快照（等同于永远重打包）。 */
export function capturePackInputSnapshot(manifest: PackManifestView, outDir: string, project: string): PackInputSnapshot | null {
    const inputs = packInputFiles(manifest);
    if (!inputs) return null;
    const files: Array<{ path: string; digest: string }> = [];
    for (const file of inputs) {
        const digest = readFileDigest(file);
        if (!digest) return null;
        files.push({ path: file, digest });
    }
    const listings: Array<{ dir: string; names: string[] }> = [];
    for (const dir of [...new Set(files.map((file) => path.dirname(file.path)))].sort()) {
        if (dir.split(/[\\/]/).includes('node_modules')) continue;
        const names = listPackInputDir(dir);
        if (!names) return null;
        listings.push({ dir, names });
    }
    const deploymentOrigins = deploymentOriginsDigest(outDir);
    if (!deploymentOrigins) return null;
    const lockfilePath = findLockfile(project);
    if (!lockfilePath) return null;
    const lockfileDigest = readFileDigest(lockfilePath);
    if (!lockfileDigest) return null;
    const manifestPath = path.join(outDir, '_vmz', 'pack-manifest.json');
    const manifestDigest = readFileDigest(manifestPath);
    if (!manifestDigest) return null;
    return {
        files,
        listings,
        deploymentOrigins,
        lockfile: { path: lockfilePath, digest: lockfileDigest },
        manifest: { path: manifestPath, digest: manifestDigest },
    };
}

/** 返回 null 表示全部输入字节全等；否则返回第一个变化原因。 */
export function packInputsChangedReason(snapshot: PackInputSnapshot, outDir: string): string | null {
    const lockfileDigest = readFileDigest(snapshot.lockfile.path);
    if (!lockfileDigest) return `lockfile unreadable: ${snapshot.lockfile.path}`;
    if (lockfileDigest !== snapshot.lockfile.digest) return 'lockfile changed';
    const manifestDigest = readFileDigest(snapshot.manifest.path);
    if (!manifestDigest) return `pack manifest unreadable: ${snapshot.manifest.path}`;
    if (manifestDigest !== snapshot.manifest.digest) return 'pack manifest changed';
    const deploymentOrigins = deploymentOriginsDigest(outDir);
    if (!deploymentOrigins) return 'deployment IR unreadable';
    if (deploymentOrigins !== snapshot.deploymentOrigins) return 'deployment IR changed';
    for (const file of snapshot.files) {
        const digest = readFileDigest(file.path);
        if (!digest) return `input unreadable: ${file.path}`;
        if (digest !== file.digest) return `input changed: ${file.path}`;
    }
    for (const listing of snapshot.listings) {
        const names = listPackInputDir(listing.dir);
        if (!names) return `input directory unreadable: ${listing.dir}`;
        if (names.length !== listing.names.length) return `input directory changed: ${listing.dir}`;
        for (let i = 0; i < names.length; i += 1) {
            if (names[i] !== listing.names[i]) return `input directory changed: ${listing.dir}`;
        }
    }
    return null;
}

/** 复用上次 manifest 前确认 entry/chunk/island 查表指向的文件仍在盘上；缺任何一个就退回真实 pack。 */
export function missingPackOutput(manifest: PackManifestView, outDir: string): string | null {
    const packDir = path.join(outDir, '_vmz', 'pack');
    if (!existsSync(path.join(outDir, '_vmz', 'pack-manifest.json'))) return '_vmz/pack-manifest.json';
    const names = new Set<string>();
    for (const entry of manifest.entryFiles ?? []) if (typeof entry.file === 'string' && entry.file) names.add(entry.file);
    for (const dynamic of manifest.dynamicFiles ?? []) {
        if (typeof dynamic.from === 'string' && dynamic.from) names.add(dynamic.from);
        if (typeof dynamic.to === 'string' && dynamic.to) names.add(dynamic.to);
    }
    for (const chunk of manifest.chunks ?? []) {
        if (typeof chunk.fileName === 'string' && chunk.fileName) names.add(chunk.fileName);
        if (typeof chunk.sourceMap === 'string' && chunk.sourceMap) names.add(chunk.sourceMap);
    }
    for (const style of manifest.styles ?? []) if (typeof style.fileName === 'string' && style.fileName) names.add(style.fileName);
    for (const asset of manifest.assets ?? []) if (typeof asset.fileName === 'string' && asset.fileName) names.add(asset.fileName);
    for (const unit of manifest.unitChunks ?? []) if (typeof unit.fileName === 'string' && unit.fileName) names.add(unit.fileName);
    for (const name of names) {
        if (!existsSync(path.join(packDir, ...name.split('/')))) return name;
    }
    return null;
}

export function createDevSession(options: DevSessionOptions) {
    const project = options.project;
    const outDir = options.outDir;
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 5173;
    const pollMs = Math.max(50, options.pollMs ?? 300);
    const wechatPreview = options.target === 'mini-program-wechat';
    let delivery = options.delivery ?? null;
    const createWs = options.createWorkspaceFn ?? createWorkspace;
    const spawnHost = options.spawnHostFn ?? defaultSpawnHost;
    const softReload = options.softReloadFn ?? ((body: Record<string, unknown>) => defaultReloadRequest(host, port, body));
    const packBrowser = options.packFn ?? packFromDeploymentIr;
    const makeConfigCycle = options.configCycleFn ?? createConfigCycle;
    const configCandidates = configCandidatePaths(project);
    let configCycle: ConfigCycle | null = null;

    const ws = createWs({ root: project, outDir });
    let child: import('node:child_process').ChildProcess | null = null;
    let stopped = false;
    let lastOutputRevision: string | null = null;
    let lastStaticRevision: string | null = null;
    let lastBuildMs = 0;
    let lastPackManifest: PackManifestView | null = null;
    let lastPackInputs: PackInputSnapshot | null = null;
    const generationIgnore = new Set<string>();

    function planAndRebuild(changes?: Array<{ path: string; kind: 'update' | 'delete' }>) {
        if (changes?.length) ws.updateFiles(changes);
        let hmrPlan = null;
        try {
            if (typeof ws.queryHmrPlan === 'function') {
                hmrPlan = parseHmrPlan(ws.queryHmrPlan());
            }
        } catch {
            hmrPlan = null;
        }
        const startedAt = Date.now();
        const report = ws.build();
        lastBuildMs = Date.now() - startedAt;
        return { report, hmrPlan };
    }

    function rebuild(changes?: Array<{ path: string; kind: 'update' | 'delete' }>) {
        return planAndRebuild(changes).report;
    }

    async function emitPublicAndTrack() {
        const { emitPublicStaticAssets } = await import('../workspace/public-static-assets.js');
        const artifact = emitPublicStaticAssets(outDir, { projectRoot: project });
        lastStaticRevision = staticRevisionFromArtifact(artifact);
        return artifact;
    }

    async function maybeReloadAfterBuild(report, hmrPlan, opts: { force?: boolean; staticOnly?: boolean } = {}) {
        const rev = report.outputRevision ?? report.output_revision ?? null;
        if (!opts.force && !opts.staticOnly && !shouldSoftReload(report, lastOutputRevision)) {
            log.info('rebuild ok — artifact unchanged, skip soft reload');
            if (rev) lastOutputRevision = rev;
            registerWrittenOutputsIgnore(report.writtenOutputs ?? report.written_outputs, outDir, project, generationIgnore);
            return 'skip';
        }
        const payload = buildReloadPayload(report, hmrPlan, {
            staticRevision: lastStaticRevision ?? undefined,
        });
        if (opts.staticOnly) {
            payload.full = false;
            payload.islandHmr = false;
        }
        const kind = await reloadAfterBuild(payload, { staticOnly: Boolean(opts.staticOnly) });
        if (rev) lastOutputRevision = rev;
        registerWrittenOutputsIgnore(report.writtenOutputs ?? report.written_outputs, outDir, project, generationIgnore);
        return kind;
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
        log.info(`${label} ok (${mode}; chunks=[${chunks}]; ${(report.emitted ?? []).length} emitted; ${lastBuildMs}ms build)`);
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
            // Same prepared snapshot for this build cycle; native pack never reads config.
            materializeWechatPackaging(project, delivery);
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

    async function waitHostUp(timeoutMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const res = await fetch(`http://${host}:${port}/__vmz/health`);
                if (res.ok) return;
            } catch {
                /* not up yet */
            }
            await sleep(50);
        }
        throw new Error(`serve-host not up on ${host}:${port}`);
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

    /**
     * 两阶段重建：host `prepare` 写入口 → CLI 侧 `vmz-pack` → host `commit` 发布。
     * dev 的浏览器交付必须走 pack，否则逐文件模块保留裸包说明符。
     * pack 失败显式 SSE error 且不回退到未打包入口。`staticOnly`（仅 public
     * 资产）不改变客户端图，因此不重打包。
     */
    async function reloadWithPack(payload, opts: { staticOnly?: boolean; initial?: boolean } = {}) {
        try {
            await softReload({ phase: 'prepare', payload });
        } catch (err) {
            if (opts.initial) {
                log.warn(`initial serve-host load failed (${err}) — host stays up`);
                return 'error';
            }
            log.warn(`soft reload failed (${err}) — auto-respawning serve-host`);
            await respawnHost('soft-reload-failed');
            return 'respawn';
        }
        if (!opts.staticOnly) {
            const startedAt = Date.now();
            const changedReason = lastPackInputs ? packInputsChangedReason(lastPackInputs, outDir) : 'no pack input snapshot';
            const missing = changedReason === null && lastPackManifest ? missingPackOutput(lastPackManifest, outDir) : null;
            if (changedReason === null && !missing && lastPackManifest) {
                log.info(`dev pack skip (inputs unchanged, ${Date.now() - startedAt}ms)`);
            } else {
                if (changedReason) log.info(`dev pack (inputs changed: ${changedReason})`);
                if (missing) log.info(`dev pack (manifest reuse rejected: missing ${missing})`);
                try {
                    const { manifest } = packBrowser(outDir, { projectRoot: project });
                    lastPackManifest = manifest as PackManifestView;
                    lastPackInputs = capturePackInputSnapshot(lastPackManifest, outDir, project);
                    log.info(`dev pack ok (${manifest.chunkCount} chunks, ${Date.now() - startedAt}ms)`);
                    if (!lastPackInputs) log.info('dev pack inputs: snapshot unavailable (unknown input) — next rebuild repacks');
                } catch (err) {
                    lastPackManifest = null;
                    lastPackInputs = null;
                    const message = err instanceof Error ? err.message : String(err);
                    log.error(`dev pack failed: ${message}`);
                    try {
                        await softReload({
                            phase: 'abort',
                            error: { message, stack: err instanceof Error ? err.stack : undefined },
                        });
                    } catch {
                        /* host may be gone; keep the reported pack error */
                    }
                    return 'error';
                }
            }
        }
        try {
            await softReload({ phase: 'commit' });
            return 'soft';
        } catch (err) {
            if (opts.initial) {
                log.warn(`initial serve-host commit failed (${err}) — host stays up`);
                return 'error';
            }
            log.warn(`reload commit failed (${err}) — auto-respawning serve-host`);
            await respawnHost('commit-failed');
            return 'respawn';
        }
    }

    async function respawnHost(reason) {
        log.warn(`respawning serve-host (${reason})…`);
        killChild(child);
        child = null;
        await waitHostGone();
        child = spawnHost({ project, outDir, host, port });
        await waitHostUp();
        const kind = await reloadWithPack({}, { initial: true });
        if (kind === 'soft') log.info('serve-host respawned — browser SSE will reconnect and reload');
        else log.warn('serve-host respawned but initial reload failed — fix the error and save');
    }

    /** @param {object} payload */
    async function reloadAfterBuild(payload, opts: { staticOnly?: boolean } = {}) {
        return reloadWithPack(payload, opts);
    }

    let docEnginesPromise: Promise<{ markdown?: string; code?: string } | undefined> | null = null;
    /** `engines.code` / `engines.markdown` for the document layer (loaded once per session). */
    function docEngines() {
        if (!docEnginesPromise) {
            docEnginesPromise = loadVmzConfig(project)
                .then((cfg) => cfg.engines as { markdown?: string; code?: string } | undefined)
                .catch(() => undefined);
        }
        return docEnginesPromise;
    }

    async function start() {
        const src = path.join(project, 'src');
        if (!existsSync(src)) {
            throw new Error(`vmz dev: missing src/ under ${project}`);
        }

        // Snapshot watch roots and their fingerprints **before** the initial build.
        // A save that lands while `vmz dev` boots must still be detected by the first
        // poll. Taking the baseline after the initial reload absorbs that edit into the
        // baseline, so the host serves the pre-edit bytes until the next save.
        const docsRoot = path.join(project, 'documents');
        const localesRoot = path.join(project, 'locales');
        const designsRoot = path.join(project, 'designs');
        const watched = collectDevWatchRoots({ project, outDir });
        const publicRoot = watched.publicRoot;
        /** Candidate config files plus their local reachable deps; refreshed after each cycle. */
        const refreshConfigPaths = () => {
            const deps = configCandidates
                .filter((p) => existsSync(p))
                .flatMap((p) => collectConfigDependencies(p, project));
            return [...new Set([...configCandidates, ...deps])];
        };
        let configPaths = refreshConfigPaths();
        /** @type {string[]} */
        const watchRoots = [...watched.roots];
        /** @type {string[]} */
        let dependencyRoots: string[] = [...watched.dependencyRoots];
        /** @type {Map<string, Map<string, string>>} */
        const fingerprints = new Map();
        for (const root of watchRoots) {
            fingerprints.set(root, fileFingerprintMap(root));
        }
        let configFingerprints = configFingerprintMap(configPaths);

        // Config evaluation + plugin contributions run in a detached build process.
        // Functions/plugin objects never cross the boundary; only the data report does.
        if (configCandidates.some((p) => existsSync(p))) {
            configCycle = makeConfigCycle({ project, outDir, ...(options.configCycleWorkerPath ? { workerPath: options.configCycleWorkerPath } : {}) });
            const report = await configCycle.start();
            if (!report.ok) throw cycleFailure(report);
            delivery = report.delivery ?? delivery;
            log.info(
                `config build process ready${report.plugins.length ? ` (${report.plugins.map((p) => p.name).join(', ')})` : ''}`,
            );
        }

        log.info('initial build (N-API workspace, full)…');
        const initialPair = planAndRebuild();
        const initial = initialPair.report;
        if (!printReport(initial, 'build')) {
            throw new Error('vmz dev: initial build failed');
        }
        lastOutputRevision = initial.outputRevision ?? initial.output_revision ?? null;

        // `vmz build` assemble copies `public/**` → outDir; soft `ws.build()` does not.
        await emitPublicAndTrack();

        // Reclaim orphan serve-host from a previous crashed launcher (same outDir).
        reclaimStaleDevHost(outDir);

        if (projectHasDocuments(project)) {
            const docs = await buildIntegratedDocuments({ projectRoot: project, outDir, engines: await docEngines() });
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
            await waitHostUp().catch((err) => {
                log.warn(String(err));
            });
            const initialKind = await reloadAfterBuild({}, { staticOnly: false }).catch((err) => {
                log.warn(`initial reload failed: ${err}`);
                return 'error';
            });
            if (initialKind !== 'soft') log.warn('initial serve-host reload failed — fix the error and save');
        }
        if (wechatPreview) {
            log.info(`dev → WeChat DevTools (watching ${watchRoots.join(', ')}; keep dist/wechat open)`);
        } else {
            log.info(`dev → http://${host}:${port} (watching ${watchRoots.join(', ')})`);
        }
        if (dependencyRoots.length) {
            log.info(`dev dependency watch roots (${dependencyRoots.length}): ${dependencyRoots.join(', ')}`);
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
            /** @type {{ srcChanged: string[], srcDeleted: string[], depChanged: string[], depDeleted: string[], designsChanged: string[], designsDeleted: string[], publicChanged: string[], docsDirty: boolean, localesDirty: boolean, designsDirty: boolean, configDirty: boolean }} */
            const batch = {
                srcChanged: [],
                srcDeleted: [],
                depChanged: [],
                depDeleted: [],
                designsChanged: [],
                designsDeleted: [],
                publicChanged: [],
                docsDirty: false,
                localesDirty: false,
                designsDirty: false,
                configDirty: false,
            };
            const watchCtx = { src, docsRoot, localesRoot, designsRoot, publicRoot, dependencyRoots };
            for (const root of watchRoots) {
                const prev = fingerprints.get(root) || new Map();
                const next = fileFingerprintMap(root);
                const diff = diffFingerprints(prev, next);
                if (!diff.changed.length && !diff.deleted.length) continue;
                const kind = classifyWatchRoot(root, watchCtx);
                if (kind === 'src') {
                    batch.srcChanged.push(...diff.changed);
                    batch.srcDeleted.push(...diff.deleted);
                } else if (kind === 'public') {
                    batch.publicChanged.push(...diff.changed);
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
                    await respawnHost('host-exited');
                    continue;
                }

                let batch;
                try {
                    batch = scanBatch();
                    const nextConfigFp = configFingerprintMap(configPaths);
                    const configDiff = diffFingerprints(configFingerprints, nextConfigFp);
                    if (configDiff.changed.length || configDiff.deleted.length) {
                        batch.configDirty = true;
                    }
                } catch (err) {
                    log.warn('watch error:', err);
                    continue;
                }

                if (generationIgnore.size) {
                    batch.srcChanged = filterGenerationIgnore(batch.srcChanged, generationIgnore);
                    batch.srcDeleted = filterGenerationIgnore(batch.srcDeleted, generationIgnore);
                    generationIgnore.clear();
                }

                const srcDirty = batch.srcChanged.length + batch.srcDeleted.length;
                const depDirty = batch.depChanged.length + batch.depDeleted.length;
                const designsDirty = batch.designsDirty || batch.designsChanged.length + batch.designsDeleted.length;
                const publicDirty = batch.publicChanged.length;
                if (!srcDirty && !depDirty && !batch.docsDirty && !batch.localesDirty && !designsDirty && !publicDirty && !batch.configDirty) {
                    continue;
                }

                if (batch.configDirty) {
                    log.info('vmz.config change detected — restarting the config build process…');
                    let cycleReport: ConfigCycleReport | null = null;
                    if (configCandidates.some((p) => existsSync(p))) {
                        let failure: Error | null = null;
                        try {
                            if (!configCycle) {
                                configCycle = makeConfigCycle({
                                    project,
                                    outDir,
                                    ...(options.configCycleWorkerPath ? { workerPath: options.configCycleWorkerPath } : {}),
                                });
                                cycleReport = await configCycle.start();
                            } else {
                                // Old process is cancelled and awaited before the new one writes artifacts.
                                cycleReport = await configCycle.restart();
                            }
                        } catch (err) {
                            failure = err instanceof Error ? err : new Error(String(err));
                        }
                        configPaths = refreshConfigPaths();
                        configFingerprints = configFingerprintMap(configPaths);
                        commitFingerprints();
                        if (failure) {
                            log.warn(`config build process restart failed: ${failure.message}`);
                            continue;
                        }
                        if (cycleReport && !cycleReport.ok) {
                            if (cycleReport.error) log.diagnostic(cycleReport.error);
                            else log.error('config build process failed');
                            continue;
                        }
                        if (cycleReport) delivery = cycleReport.delivery ?? delivery;
                    } else if (configCycle) {
                        await configCycle.cancel();
                        configCycle = null;
                        configPaths = refreshConfigPaths();
                        configFingerprints = configFingerprintMap(configPaths);
                        commitFingerprints();
                        log.warn('vmz.config removed — config build process stopped, last artifacts kept');
                        continue;
                    } else {
                        configFingerprints = configFingerprintMap(configPaths);
                        commitFingerprints();
                        continue;
                    }
                    const report = rebuild();
                    if (printReport(report, 'rebuild')) {
                        lastOutputRevision = report.outputRevision ?? report.output_revision ?? null;
                        await emitPublicAndTrack();
                        if (wechatPreview) packWechatPreview();
                        else await respawnHost('config-changed');
                    }
                    continue;
                }

                if (publicDirty && !srcDirty && !depDirty && !batch.docsDirty && !batch.localesDirty && !designsDirty) {
                    log.info(`public change detected (${publicDirty} file(s)) — re-emit static assets…`);
                    await emitPublicAndTrack();
                    commitFingerprints();
                    if (!wechatPreview) {
                        const kind = await maybeReloadAfterBuild({ reloadRequired: true }, null, { force: true, staticOnly: true });
                        if (kind === 'soft' || kind === 'respawn') log.info('soft reload ok (public assets)');
                    }
                    continue;
                }

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
                    const { report, hmrPlan } = planAndRebuild();
                    if (!printReport(report, 'rebuild')) {
                        log.warn('rebuild failed — keeping previous server');
                        continue;
                    }
                    await emitPublicAndTrack();
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
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir, engines: await docEngines() });
                        if (!docs.ok) log.warn('document mount rebuild failed — keeping previous docs');
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) log.warn('wechat pack failed — keeping previous dist/wechat');
                        continue;
                    }
                    const kind = await maybeReloadAfterBuild(report, hmrPlan, { force: true });
                    commitFingerprints();
                    if (kind === 'soft' || kind === 'respawn') {
                        log.info(kind === 'respawn' ? 'reload ok (respawned; deps)' : 'soft reload ok (full page; deps)');
                    }
                    continue;
                }

                let needFullReload = batch.docsDirty || batch.designsDirty;
                if (batch.srcChanged.length || batch.srcDeleted.length) {
                    log.info(`change detected (${batch.srcChanged.length} update, ${batch.srcDeleted.length} delete) — affected rebuild…`);
                    const changes = [
                        ...batch.srcChanged.map((p) => ({ path: p, kind: /** @type {'update'} */ ('update') })),
                        ...batch.srcDeleted.map((p) => ({ path: p, kind: /** @type {'delete'} */ ('delete') })),
                    ];
                    const { report, hmrPlan } = planAndRebuild(changes);
                    if (!printReport(report, 'rebuild')) {
                        log.warn('rebuild failed — keeping previous server');
                        continue;
                    }
                    await emitPublicAndTrack();
                    if (batch.docsDirty || projectHasDocuments(project)) {
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir, engines: await docEngines() });
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
                    const kind = await maybeReloadAfterBuild(report, hmrPlan, {
                        force: needFullReload,
                    });
                    commitFingerprints();
                    if (kind === 'soft' || kind === 'respawn') {
                        log.info(
                            kind === 'respawn'
                                ? 'reload ok (respawned serve-host)'
                                : needFullReload
                                  ? 'soft reload ok (full page; docs)'
                                  : report.islandHmr
                                    ? 'soft reload ok (island HMR)'
                                    : 'soft reload ok',
                        );
                    }
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
                    const { report, hmrPlan } = planAndRebuild(changes.length ? changes : undefined);
                    if (!printReport(report, 'rebuild')) {
                        log.warn('designs rebuild failed — keeping previous styles');
                        continue;
                    }
                    await emitPublicAndTrack();
                    if (batch.docsDirty || projectHasDocuments(project)) {
                        const docs = await buildIntegratedDocuments({ projectRoot: project, outDir, engines: await docEngines() });
                        if (!docs.ok) log.warn('document mount rebuild failed — keeping previous docs');
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) log.warn('wechat pack failed — keeping previous dist/wechat');
                        continue;
                    }
                    const kind = await maybeReloadAfterBuild(report, hmrPlan, { force: true });
                    commitFingerprints();
                    if (kind === 'soft' || kind === 'respawn') {
                        log.info(kind === 'respawn' ? 'reload ok (respawned; designs)' : 'soft reload ok (full page; designs)');
                    }
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
                        const kind = await maybeReloadAfterBuild({ reloadRequired: true, full: true }, null, { force: true });
                        commitFingerprints();
                        if (kind === 'soft' || kind === 'respawn') {
                            log.info(kind === 'respawn' ? 'reload ok (respawned; locales)' : 'soft reload ok (full page; locales)');
                        }
                        if (!batch.docsDirty) continue;
                    }
                }

                if (batch.docsDirty) {
                    log.info('documents change detected — rebuilding document mount…');
                    const docs = await buildIntegratedDocuments({ projectRoot: project, outDir, engines: await docEngines() });
                    if (!docs.ok) {
                        log.warn('document mount rebuild failed — keeping previous docs');
                        continue;
                    }
                    if (wechatPreview) {
                        if (!packWechatPreview()) {
                            log.warn('wechat pack failed — keeping previous dist/wechat');
                        }
                    } else {
                        const kind = await maybeReloadAfterBuild({ reloadRequired: true, full: true }, null, { force: true });
                        commitFingerprints();
                        if (kind === 'soft' || kind === 'respawn') {
                            log.info(kind === 'respawn' ? 'reload ok (respawned; docs)' : 'soft reload ok (full page; docs)');
                        }
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
        await configCycle?.cancel().catch(() => {});
        configCycle = null;
        clearDevHostPid(outDir, null);
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
    const child = spawn(node, [hostJs], {
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
        // Keep child in the same process group so launcher exit can reclaim it.
        detached: false,
        windowsHide: true,
    });
    writeDevHostPid(opts.outDir, child.pid);
    child.once('exit', () => clearDevHostPid(opts.outDir, child.pid));
    return child;
}

/**
 * Host reload request（两阶段协议：`prepare` / `commit` / `abort`）。
 * @param {string} host
 * @param {number} port
 * @param {Record<string, unknown>} body
 */
async function defaultReloadRequest(host, port, body) {
    const url = `http://${host}:${port}/__vmz/reload`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    if (!json?.ok) throw new Error(JSON.stringify(json));
    return json;
}

function killChild(child) {
    if (!child || child.killed) return;
    const pid = child.pid;
    try {
        if (process.platform === 'win32' && pid) {
            // Tree-kill so orphaned grandchildren (if any) do not keep the port.
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
        } else {
            child.kill('SIGTERM');
        }
    } catch {
        try {
            child.kill();
        } catch {
            /* ignore */
        }
    }
}

function devHostPidPath(outDir) {
    return path.join(outDir, DEV_HOST_PID);
}

function writeDevHostPid(outDir, pid) {
    if (!outDir || !pid) return;
    try {
        writeFileSync(devHostPidPath(outDir), `${pid}\n`, 'utf8');
    } catch {
        /* ignore */
    }
}

function clearDevHostPid(outDir, pid) {
    if (!outDir) return;
    try {
        const p = devHostPidPath(outDir);
        if (!existsSync(p)) return;
        if (pid != null) {
            const cur = Number(readFileSync(p, 'utf8').trim());
            if (Number.isFinite(cur) && cur !== pid) return;
        }
        unlinkSync(p);
    } catch {
        /* ignore */
    }
}

/** Kill leftover serve-host recorded for this outDir (previous crashed `vmz dev`). */
function reclaimStaleDevHost(outDir) {
    const p = devHostPidPath(outDir);
    if (!existsSync(p)) return;
    let pid = 0;
    try {
        pid = Number(readFileSync(p, 'utf8').trim());
    } catch {
        clearDevHostPid(outDir, null);
        return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
        clearDevHostPid(outDir, null);
        return;
    }
    if (pid === process.pid) {
        clearDevHostPid(outDir, null);
        return;
    }
    try {
        process.kill(pid, 0);
    } catch {
        clearDevHostPid(outDir, null);
        return;
    }
    log.warn(`reclaiming stale serve-host pid=${pid} (prior vmz dev left an orphan)`);
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
        } else {
            process.kill(pid, 'SIGTERM');
        }
    } catch {
        /* ignore */
    }
    clearDevHostPid(outDir, null);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

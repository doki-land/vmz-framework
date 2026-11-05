/**
 * Pack stage: run the browser delivery graph through the Rust `vmz-pack`
 * binding (N-API `packPlan`/`packWrite`, frozen v0 contract) and record the
 * resulting chunk/asset mapping in `_vmz/pack-manifest.json`.
 *
 * Browser graph roots are the bootstrap modules (`entry-client.js` /
 * `entry-event.js`) emitted by the compiler / static delivery path; page and
 * island modules enter the graph through the bootstrap's literal dynamic
 * import tables, never as pack entries. Bootstrap entries declare
 * `execution: 'full'` + `exports: { kind: 'all' }` (script-tag load,
 * whole-module execution).
 *
 * SSR/Node is a separate graph: Node entries are the deployment units
 * reachable from the page / application roots through `dependsOn` (logical =
 * `chunkId`), packed under `_vmz/pack-node/` and indexed by
 * `_vmz/pack-node-manifest.json`. Components have no Node consumer unless a
 * page or layout reaches them, so orphan units are not packed. Node consumers
 * never fall back to the unpacked root `${chunkId}.client.js`; browser
 * bootstrap modules are not Node entries because they bind `dom.browser` /
 * `document`.
 *
 * No vendor materialization, no specifier lowering, and no second hashing
 * pass happen here: `packWrite` emits the final browser JS set under
 * `_vmz/pack/` with content-hashed names, and consumers resolve logical
 * entries through `packEntryHref()` against this manifest.
 */

import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDeploymentIr } from './bundler-adapter.js';
import type { DeploymentIr } from './bundler-adapter.js';
import { buildPackRequest, runPackWrite } from './pack-native.js';
import type { PackNativeBinding, PackRequestUse } from './pack-native.js';
import { deliveryRuntimeFilePairs } from './delivery-runtime-files.js';
import { rewriteDeliveryImports } from './delivery-runtime-imports.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const PACK_MANIFEST_SCHEMA = 'vmz.pack.manifest.v0';

/** Directory (relative to outDir) where `packWrite` emits the final browser JS set. */
export const PACK_OUTPUT_DIR_REL = '_vmz/pack';

/** Site root base — VMZ static delivery has no configurable base (see delivery-profile). */
export const PACK_PUBLIC_BASE = '/';

/**
 * Projection provenance for the pack graph: each deployment unit's emitted
 * client entry maps back to its source `.vmz`. Bare-specifier package discovery
 * then walks up from the source location — dependency components (e.g. a
 * `@vmz/ui` component importing its own peer) keep their source package's
 * node_modules visibility, matching Node realpath semantics. Relative
 * specifiers keep resolving against the emitted tree.
 */
export function deploymentUnitOrigins(absOut: string, ir: DeploymentIr): Record<string, string> {
    const origins: Record<string, string> = {};
    for (const unit of ir.units || []) {
        const source = String(unit.source || '');
        const chunkId = String(unit.chunkId || '').replace(/\\/g, '/');
        if (!source || !chunkId) continue;
        const rel = (unit.clientEntry ? String(unit.clientEntry) : `${chunkId}.client.js`).replace(/\\/g, '/');
        const emitted = path.join(absOut, ...rel.split('/'));
        if (!existsSync(emitted) || !existsSync(source)) continue;
        origins[realpathSync(emitted)] = realpathSync(source);
    }
    return origins;
}

/** Bootstrap modules that are browser pack entries when present in outDir. */
const BOOTSTRAP_ENTRIES = ['entry-client.js', 'entry-event.js'];

/** 一个 deployment 逻辑 chunkId 在浏览器图里的落点（未进图时字段为 `null`）。 */
export interface PackUnitChunk {
    /** 运行时逻辑 chunk id（`vmz-deployment.json` 的 `units[].chunkId`）。 */
    logical: string;
    /** 该单元的产物客户端文件（输出树相对路径）。 */
    clientEntry: string;
    /** 承载该文件的 chunk id，未进客户端图时为 `null`。 */
    chunkId: string | null;
    /** 承载该文件的 chunk 文件名，未进客户端图时为 `null`。 */
    fileName: string | null;
}

/**
 * 模块路径比较键：去掉 Windows verbatim 前缀（Rust `canonicalize` 给 `//?/E:/…`，
 * Node `realpathSync` 给 `E:/…`）并统一分隔符，避免同一文件因前缀差异查不到。
 */
function moduleKey(filePath: string): string {
    return filePath.replace(/^(?:\\\\\?\\|\/\/\?\/)/, '').replace(/\\/g, '/');
}

/**
 * 逻辑 chunkId → 浏览器 chunk 的精确查表：按部署单元的产物客户端文件与
 * chunk `modules` 的同路径匹配，不做后缀匹配、不猜命名规则。单元产物未进
 * 客户端图（无消费者）时显式记 `null`，消费方可据此报错而不是静默取错 chunk。
 */
function resolveUnitChunks(
    absOut: string,
    deploymentUnits: ReadonlyArray<{ chunkId?: string; clientEntry?: string }>,
    artifacts: ReadonlyArray<{ chunkId: string; fileName: string; modules: string[] }>,
): PackUnitChunk[] {
    const chunkOfModule = new Map<string, { chunkId: string; fileName: string }>();
    for (const artifact of artifacts) {
        for (const module of artifact.modules) {
            chunkOfModule.set(moduleKey(module), { chunkId: artifact.chunkId, fileName: artifact.fileName });
        }
    }
    const out: PackUnitChunk[] = [];
    for (const unit of deploymentUnits) {
        const logical = String(unit.chunkId || '').replace(/\\/g, '/');
        if (!logical) continue;
        const clientEntry = (unit.clientEntry ? String(unit.clientEntry) : `${logical}.client.js`).replace(
            /\\/g,
            '/',
        );
        const abs = path.join(absOut, ...clientEntry.split('/'));
        const hit = chunkOfModule.get(moduleKey(existsSync(abs) ? realpathSync(abs) : abs)) ?? null;
        out.push({
            logical,
            clientEntry,
            chunkId: hit ? hit.chunkId : null,
            fileName: hit ? hit.fileName : null,
        });
    }
    out.sort((a, b) => (a.logical < b.logical ? -1 : a.logical > b.logical ? 1 : 0));
    return out;
}

/**
 * Ensure dom split companions sit next to vmz-dom.js (barrel imports ./dom-core.js).
 * Always refresh from `@vmz/core` when present so SSR/runtime fixes are not sticky in outDir.
 * Document surfaces (Node-side document layout mount) consume this; browser delivery
 * runtime files reach the pack graph through `@vmz/core` bare imports in the Rust graph.
 * @param {string} outDir
 * @param {string | null | undefined} coreDist `@vmz/core` dist root
 * @returns {string[]} copied relative names
 */
export function ensureRuntimeCompanions(outDir, coreDist) {
    if (!coreDist) return [];
    const copied = [];
    for (const [srcRel, outName] of deliveryRuntimeFilePairs()) {
        const src = path.join(coreDist, srcRel);
        if (!existsSync(src)) continue;
        const dest = path.join(outDir, outName);
        const text = rewriteDeliveryImports(readFileSync(src, 'utf8'), outName);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, text);
        copied.push(outName);
    }
    return copied;
}

interface PackFromDeploymentIrOpts {
    release?: boolean;
    profileId?: string;
    assembly?: string;
    preferredClientFace?: string;
    projectRoot?: string | null;
    /** Test seam: inject a fake binding. Defaults to the loaded N-API addon. */
    binding?: PackNativeBinding;
}

/**
 * Pack the browser delivery graph via the Rust `vmz-pack` binding and write
 * `_vmz/pack-manifest.json` (v0). Entries are the bootstrap modules that
 * already exist in `outDir` — an empty bootstrap set is an explicit request
 * error, never a silently skipped stage.
 */
export function packFromDeploymentIr(outDir: string, opts: PackFromDeploymentIrOpts = {}) {
    const absOut = path.resolve(outDir);
    const root = opts.projectRoot ? path.resolve(opts.projectRoot) : path.dirname(absOut);

    const entries: Record<string, string> = {};
    for (const logical of BOOTSTRAP_ENTRIES) {
        const abs = path.join(absOut, logical);
        if (existsSync(abs)) entries[logical] = abs;
    }
    const uses: PackRequestUse[] = Object.keys(entries).map((logical) => ({
        logical,
        execution: 'full',
        exports: { kind: 'all' },
    }));
    // Browser graph entries are the bootstrap modules; page/island units join
    // through the bootstrap dynamic-import tables and need projection provenance.
    const origins = deploymentUnitOrigins(absOut, loadDeploymentIr(absOut));
    const requestJson = buildPackRequest({
        entries,
        target: 'browser',
        root,
        outRoot: absOut,
        uses,
        publicBase: PACK_PUBLIC_BASE,
        origins,
    });

    const packOutDir = path.join(absOut, ...PACK_OUTPUT_DIR_REL.split('/'));
    // 不再整体清空输出目录：`packWrite` 按内容摘要复用未变 chunk，并在写盘后
    // 逐文件清理不再属于产物闭包的旧 chunk / map / css / assets（不留孤儿）。
    const { plan } = runPackWrite(requestJson, packOutDir, opts.binding ? { binding: opts.binding } : {});

    const ir = loadDeploymentIr(absOut);
    let nativeManifest: unknown;
    try {
        nativeManifest = JSON.parse(plan.manifestJson);
    } catch (error) {
        throw new Error(`pack manifestJson from binding is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const chunks = plan.artifacts.map((a) => {
        const buf = Buffer.from(a.code, 'utf8');
        return {
            chunkId: a.chunkId,
            fileName: a.fileName,
            modules: a.modules,
            bytes: buf.length,
            digest: sha256Hex(buf),
            sourceMap: a.sourceMapFileName,
        };
    });

    const body: {
        schema: string;
        profileId: string | null;
        assembly: string | null;
        release: boolean;
        preferredClientFace: string;
        deploymentSchema: unknown;
        target: 'browser';
        publicBase: string;
        entries: Array<{ logical: string; file: string }>;
        entryFiles: unknown[];
        dynamicFiles: unknown[];
        styles: unknown[];
        assets: unknown[];
        chunks: unknown[];
        unitChunks: PackUnitChunk[];
        chunkCount: number;
        styleCount: number;
        entryCount: number;
        minify: string;
        treeShake: string;
        sourceMaps: string;
        packInputDigest: string;
        packGraphDigest: string;
        nativeManifest: unknown;
        packDigest?: string;
    } = {
        schema: PACK_MANIFEST_SCHEMA,
        profileId: opts.profileId || null,
        assembly: opts.assembly || null,
        release: Boolean(opts.release),
        preferredClientFace: opts.preferredClientFace || '@vmz/core/dom/client',
        deploymentSchema: ir.schema,
        target: 'browser',
        publicBase: PACK_PUBLIC_BASE,
        entries: Object.keys(entries)
            .sort()
            .map((logical) => ({ logical, file: path.relative(absOut, entries[logical]).replace(/\\/g, '/') })),
        entryFiles: plan.entryFiles,
        dynamicFiles: plan.dynamicFiles,
        // CSS artifacts are final bytes under `_vmz/pack/` (`packWrite` wrote
        // them); the wire carries identity/provenance only, never content.
        styles: plan.styles,
        assets: plan.assets,
        chunks,
        unitChunks: resolveUnitChunks(absOut, ir.units || [], plan.artifacts),
        chunkCount: chunks.length,
        styleCount: plan.styles.length,
        entryCount: plan.entryFiles.length,
        // Chunk text is token-minified inside `vmz-pack` while preserving string,
        // template and regex bodies plus ASI-significant line breaks. Identifiers
        // are not renamed and dead code is not eliminated.
        minify: 'tokens',
        // `link` active fixed-point pruning really ran — bootstrap entries
        // declare full execution, internal modules are pruned to reachable exports.
        treeShake: 'vmz-pack-link-pruning',
        // Chunk source maps are v3 token-level: every minified token maps back
        // through the assembled line to its module line (`<packOut>/<fileName>.map`,
        // `sourceMapFileName` on the wire). Generated columns are token columns,
        // source columns stay at the assembled slice start; `names` is unused.
        sourceMaps: 'chunk-v3-token-mappings',
        // `packInputDigest` 是本次 pack 输入（图结构 + 各模块源字节 + emit 选项）
        // 的内容摘要；`packGraphDigest` 只看图结构，任一边界/模块/边变化即整体
        // 失效，不允许部分 chunk 复用。两者都来自 Rust 侧，不使用 mtime/时间戳。
        packInputDigest: plan.inputDigest,
        packGraphDigest: plan.graphDigest,
        nativeManifest,
    };
    body.packDigest = sha256Hex(stableStringify({ ...body }));

    const vmzDir = path.join(absOut, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'pack-manifest.json');
    writePrettyJsonFile(file, body);
    return { manifest: body, path: file };
}

export const PACK_NODE_MANIFEST_SCHEMA = 'vmz.pack.node-manifest.v0';

/** Directory (relative to outDir) where `packWrite` emits the Node JS set. */
export const PACK_NODE_OUTPUT_DIR_REL = '_vmz/pack-node';

/** Node pack manifest (relative to outDir); `entryFiles` maps logical → chunk file. */
export const PACK_NODE_MANIFEST_REL = '_vmz/pack-node-manifest.json';

interface PackSsrFromDeploymentIrOpts {
    projectRoot?: string | null;
    /** Test seam: inject a fake binding. Defaults to the loaded N-API addon. */
    binding?: PackNativeBinding;
}

/**
 * Node graph roots and their `dependsOn` closure — the only chunk ids a Node
 * consumer can request. Pages and the application shell are roots; components
 * enter through `dependsOn` (pages merge their `layoutChain` into it). Standalone
 * layout units (`layouts/*`, emitted with kind `other`) are roots of their own
 * because `loadCtor` asks for page / layout chunk ids directly and no page lists
 * them in `dependsOn`. Units outside the closure have no Node consumer: the SSR
 * registry imports a component entry only when some root reaches it.
 */
function nodeReachableChunkIds(ir: DeploymentIr): Set<string> {
    const dependsOn = new Map<string, string[]>();
    const roots: string[] = [];
    for (const unit of ir.units || []) {
        const chunkId = String(unit.chunkId || '').replace(/\\/g, '/');
        if (!chunkId) continue;
        const deps = dependsOn.get(chunkId) ?? [];
        for (const dep of unit.dependsOn || []) {
            const id = String(dep).replace(/\\/g, '/');
            if (id) deps.push(id);
        }
        dependsOn.set(chunkId, deps);
        if (unit.kind === 'page' || unit.kind === 'application' || unit.kind === 'other') roots.push(chunkId);
    }
    const reachable = new Set<string>();
    const queue = roots.slice();
    while (queue.length) {
        const id = queue.pop() as string;
        if (reachable.has(id)) continue;
        reachable.add(id);
        for (const dep of dependsOn.get(id) ?? []) if (!reachable.has(dep)) queue.push(dep);
    }
    return reachable;
}

/**
 * Pack the SSR/Node graph via the Rust `vmz-pack` binding and write
 * `_vmz/pack-node-manifest.json` (v0). Entries are the node-reachable
 * deployment units' compiled client modules (`clientEntry`, empty → mirrors
 * `vmz-artifacts` `component_entries`: `${chunkId}.client.js`). Node consumers
 * only read `default`, but the import itself is evaluated, hence
 * `side-effects` + named default rather than `all` / `full` / `unconsumed`.
 */
export function packSsrFromDeploymentIr(outDir: string, opts: PackSsrFromDeploymentIrOpts = {}) {
    const absOut = path.resolve(outDir);
    const root = opts.projectRoot ? path.resolve(opts.projectRoot) : path.dirname(absOut);
    const ir = loadDeploymentIr(absOut);
    if (!(ir.units || []).length) {
        throw new Error(`packSsrFromDeploymentIr: deployment IR has no units in ${absOut}`);
    }
    const nodeReachable = nodeReachableChunkIds(ir);

    const entries: Record<string, string> = {};
    const uses: PackRequestUse[] = [];
    // Deployment IR may list the same component unit more than once (one entry
    // per consuming page). The node graph identity is `chunkId`, so duplicates
    // collapse into one entry; a same-identity unit pointing at a different
    // client file is a contract violation, not something to silently pick.
    const seen = new Map<string, string>();
    for (const unit of ir.units || []) {
        const chunkId = String(unit.chunkId || '').replace(/\\/g, '/');
        if (!chunkId) throw new Error(`packSsrFromDeploymentIr: deployment unit has an empty chunkId in ${absOut}`);
        if (!nodeReachable.has(chunkId)) continue;
        // `vmz-artifacts` derives the component entry as `${chunkId}.client.js`
        // when `clientEntry` is empty. Decide it here so the pack request stays
        // explicit, then require the file — a missing entry is never skipped.
        const rel = (unit.clientEntry ? String(unit.clientEntry) : `${chunkId}.client.js`).replace(/\\/g, '/');
        if (seen.has(chunkId)) {
            if (seen.get(chunkId) !== rel) {
                throw new Error(
                    `packSsrFromDeploymentIr: deployment unit "${chunkId}" maps to conflicting client entries: ` +
                        `${seen.get(chunkId)} and ${rel} (in ${absOut})`,
                );
            }
            continue;
        }
        const abs = path.join(absOut, ...rel.split('/'));
        if (!existsSync(abs)) {
            throw new Error(`packSsrFromDeploymentIr: unit "${chunkId}" client entry missing: ${rel} (in ${absOut})`);
        }
        seen.set(chunkId, rel);
        entries[chunkId] = abs;
        uses.push({ logical: chunkId, execution: 'side-effects', exports: { kind: 'named', names: ['default'] } });
    }
    if (!Object.keys(entries).length) {
        throw new Error(`packSsrFromDeploymentIr: deployment IR has no node-reachable units in ${absOut}`);
    }
    const origins = deploymentUnitOrigins(absOut, ir);
    const requestJson = buildPackRequest({
        entries,
        target: 'node',
        root,
        outRoot: absOut,
        uses,
        publicBase: PACK_PUBLIC_BASE,
        origins,
    });

    const packOutDir = path.join(absOut, ...PACK_NODE_OUTPUT_DIR_REL.split('/'));
    // 与浏览器 pack 同口径：不清空目录，由 `packWrite` 复用未变 chunk 并清理孤儿。
    const { plan } = runPackWrite(requestJson, packOutDir, opts.binding ? { binding: opts.binding } : {});

    let nativeManifest: unknown;
    try {
        nativeManifest = JSON.parse(plan.manifestJson);
    } catch (error) {
        throw new Error(
            `node pack manifestJson from binding is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const chunks = plan.artifacts.map((a) => {
        const buf = Buffer.from(a.code, 'utf8');
        return {
            chunkId: a.chunkId,
            fileName: a.fileName,
            modules: a.modules,
            bytes: buf.length,
            digest: sha256Hex(buf),
            sourceMap: a.sourceMapFileName,
        };
    });

    // dist roots carry no package.json; Node needs one beside the chunk set to
    // treat content-hashed `.js` files as ESM.
    mkdirSync(packOutDir, { recursive: true });
    writeFileSync(path.join(packOutDir, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`, 'utf8');

    const body: {
        schema: string;
        target: 'node';
        deploymentSchema: unknown;
        entries: Array<{ logical: string; file: string }>;
        entryFiles: unknown[];
        dynamicFiles: unknown[];
        chunks: unknown[];
        chunkCount: number;
        entryCount: number;
        packInputDigest: string;
        packGraphDigest: string;
        nativeManifest: unknown;
        packDigest?: string;
    } = {
        schema: PACK_NODE_MANIFEST_SCHEMA,
        target: 'node',
        deploymentSchema: ir.schema,
        entries: Object.keys(entries)
            .sort()
            .map((logical) => ({ logical, file: path.relative(absOut, entries[logical]).replace(/\\/g, '/') })),
        entryFiles: plan.entryFiles,
        dynamicFiles: plan.dynamicFiles,
        chunks,
        chunkCount: chunks.length,
        entryCount: plan.entryFiles.length,
        // 同浏览器 pack：输入/图结构摘要来自 Rust 侧内容摘要判定。
        packInputDigest: plan.inputDigest,
        packGraphDigest: plan.graphDigest,
        nativeManifest,
    };
    body.packDigest = sha256Hex(stableStringify({ ...body }));

    const file = path.join(absOut, ...PACK_NODE_MANIFEST_REL.split('/'));
    writePrettyJsonFile(file, body);
    return { manifest: body, path: file };
}

/**
 * Resolve a Node logical entry (`chunkId`) to its packed absolute file from
 * `_vmz/pack-node-manifest.json`. Missing manifest, missing logical, or a
 * missing chunk file is an explicit error — never a fallback to the unpacked
 * root `${chunkId}.client.js`.
 */
export function packNodeEntryFile(outDir: string, chunkId: string): string {
    const absOut = path.resolve(outDir);
    const manifestPath = path.join(absOut, ...PACK_NODE_MANIFEST_REL.split('/'));
    if (!existsSync(manifestPath)) {
        throw new Error(`packNodeEntryFile: missing ${manifestPath} — run vmz build (node pack) first`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        entryFiles?: Array<{ logical?: string; file?: string }>;
    };
    const hit = (manifest.entryFiles || []).find((e) => e && e.logical === chunkId);
    if (!hit || typeof hit.file !== 'string' || !hit.file) {
        throw new Error(`packNodeEntryFile: node pack manifest has no entry file for "${chunkId}"`);
    }
    const abs = path.join(absOut, ...PACK_NODE_OUTPUT_DIR_REL.split('/'), ...hit.file.split('/'));
    if (!existsSync(abs)) {
        throw new Error(`packNodeEntryFile: node pack chunk missing on disk: ${path.relative(absOut, abs)}`);
    }
    return abs;
}

/**
 * Resolve the final browser URL of a packed logical entry from
 * `_vmz/pack-manifest.json` (`entryFiles` is the only logical→physical map).
 * Missing manifest or missing logical entry is an explicit error — no
 * fallback to unpacked root bytes.
 */
export function packEntryHref(outDir: string, logical: string): string {
    const manifestPath = path.join(path.resolve(outDir), '_vmz', 'pack-manifest.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`packEntryHref: missing ${manifestPath} — run vmz build (pack) first`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        publicBase?: string;
        entryFiles?: Array<{ logical?: string; file?: string }>;
    };
    const hit = (manifest.entryFiles || []).find((e) => e && e.logical === logical);
    if (!hit || typeof hit.file !== 'string' || !hit.file) {
        throw new Error(`packEntryHref: pack manifest has no entry file for "${logical}"`);
    }
    const base = String(manifest.publicBase || PACK_PUBLIC_BASE).replace(/\/$/, '');
    return `${base}/${PACK_OUTPUT_DIR_REL}/${hit.file}`;
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = sortKeys((value as Record<string, unknown>)[k]);
        }
        return out;
    }
    return value;
}

function sha256Hex(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

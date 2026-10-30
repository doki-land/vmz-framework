/**
 * Pack stage: run the browser delivery graph through the Rust `vmz-pack`
 * binding (N-API `packPlan`/`packWrite`, frozen v0 contract) and record the
 * resulting chunk/asset mapping in `_vmz/pack-manifest.json`.
 *
 * Browser graph roots are the bootstrap modules (`entry-client.js` /
 * `entry-event.js`) emitted by the compiler / static delivery path; page and
 * island modules enter the graph through the bootstrap's literal dynamic
 * import tables, never as pack entries. `usedExports: null` keeps every
 * bootstrap export live (script-tag load, whole-module execution).
 *
 * No vendor materialization, no specifier lowering, and no second hashing
 * pass happen here: `packWrite` emits the final browser JS set under
 * `_vmz/pack/` with content-hashed names, and consumers resolve logical
 * entries through `packEntryHref()` against this manifest.
 */

import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDeploymentIr } from './bundler-adapter.js';
import { buildPackRequest, runPackWrite } from './pack-native.js';
import type { PackNativeBinding } from './pack-native.js';
import { deliveryRuntimeFilePairs } from './delivery-runtime-files.js';
import { rewriteDeliveryImports } from './delivery-runtime-imports.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const PACK_MANIFEST_SCHEMA = 'vmz.pack.manifest.v0';

/** Directory (relative to outDir) where `packWrite` emits the final browser JS set. */
export const PACK_OUTPUT_DIR_REL = '_vmz/pack';

/** Site root base — VMZ static delivery has no configurable base (see delivery-profile). */
export const PACK_PUBLIC_BASE = '/';

/** Bootstrap modules that are browser pack entries when present in outDir. */
const BOOTSTRAP_ENTRIES = ['entry-client.js', 'entry-event.js'];

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
    const uses = Object.keys(entries).map((logical) => ({ logical, usedExports: null as string[] | null }));
    const requestJson = buildPackRequest({ entries, target: 'browser', root, uses, publicBase: PACK_PUBLIC_BASE });

    const packOutDir = path.join(absOut, ...PACK_OUTPUT_DIR_REL.split('/'));
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
        assets: unknown[];
        chunks: unknown[];
        chunkCount: number;
        entryCount: number;
        minify: string;
        treeShake: string;
        sourceMaps: string;
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
        assets: plan.assets,
        chunks,
        chunkCount: chunks.length,
        entryCount: plan.entryFiles.length,
        // `vmz-pack` runs no compressor: chunk bytes are the linked output verbatim.
        minify: 'none',
        // `link` active fixed-point pruning really ran — entries keep all exports
        // (`usedExports: null`), internal modules are pruned to reachable exports.
        treeShake: 'vmz-pack-link-pruning',
        // Source-map closure is not part of the v0 write contract yet.
        sourceMaps: 'none',
        nativeManifest,
    };
    body.packDigest = sha256Hex(stableStringify({ ...body }));

    const vmzDir = path.join(absOut, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'pack-manifest.json');
    writePrettyJsonFile(file, body);
    return { manifest: body, path: file };
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

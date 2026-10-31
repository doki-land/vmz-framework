/**
 * TS consumption layer for the Rust `vmz-pack` plan (frozen v0 contract).
 *
 * The N-API binding exports two synchronous functions:
 *   packPlan(requestJson: string): string
 *   packWrite(requestJson: string, outDir: string): string
 * Both return the same response JSON shape. The interfaces below are a verbatim
 * mirror of that contract: no renames, no guessed defaults, no dual-format
 * tolerance, and diagnostics always propagate explicitly.
 *
 * This slice is the integration layer: `pack.ts` runs the delivery path
 * through `buildPackRequest` / `runPackWrite` against this contract; real-build
 * evidence closes the switch (see the toolchain plan's delivery-path design).
 */

import path from 'node:path';
import { requireNativeAddon } from './native-addon.js';

export type PackTarget = 'browser' | 'node';

export interface PackRequestEntry {
    logical: string;
    path: string;
}

/** Execution dimension, mirroring the Rust `EntryExecution` wire. */
export type PackRequestExecution = 'full' | 'side-effects';

/** Export demand dimension, mirroring the Rust `EntryExports` tagged union. */
export type PackRequestExports =
    | { kind: 'all' }
    | { kind: 'named'; names: string[] }
    | { kind: 'unconsumed' };

export interface PackRequestUse {
    logical: string;
    /** `full` evaluates the entry wholesale; `side-effects` retains it under export demand. */
    execution: PackRequestExecution;
    /** Which entry exports a consumer reads. Explicit — never guessed. */
    exports: PackRequestExports;
}

export interface PackRequest {
    entries: PackRequestEntry[];
    target: PackTarget;
    root: string;
    uses: PackRequestUse[];
    publicBase: string;
}

export interface PackChunkArtifact {
    chunkId: string;
    fileName: string;
    code: string;
    modules: string[];
    imports: string[];
    dynamic: string[];
    /** Map file name (`<fileName>.map`); the map JSON itself stays Rust-side. */
    sourceMapFileName: string;
}

export interface PackAssetArtifact {
    modulePath: string;
    specifier: string;
    fileName: string;
    url: string;
    sourcePath: string;
}

export interface PackStyleArtifact {
    fileName: string;
    url: string;
    /** Referring JS module paths (execution order, first-wins dedup on Rust side). */
    modules: string[];
    /** Aggregated source CSS paths in cascade order. */
    sourcePaths: string[];
}

export interface PackEntryFile {
    logical: string;
    file: string;
}

export interface PackDynamicFile {
    from: string;
    to: string;
}

export interface PackPlan {
    artifacts: PackChunkArtifact[];
    styles: PackStyleArtifact[];
    assets: PackAssetArtifact[];
    entryFiles: PackEntryFile[];
    dynamicFiles: PackDynamicFile[];
    manifestJson: string;
}

export interface PackDiagnostic {
    code: string;
    message: string;
    path?: string;
    span?: [number, number];
}

export interface PackPlanResponseOk {
    ok: true;
    plan: PackPlan;
    diagnostics: PackDiagnostic[];
}

export interface PackPlanResponseFailed {
    ok: false;
    diagnostics: PackDiagnostic[];
}

export type PackPlanResponse = PackPlanResponseOk | PackPlanResponseFailed;

/** The synchronous N-API surface the two contract functions live on. */
export interface PackNativeBinding {
    packPlan(requestJson: string): string;
    packWrite(requestJson: string, outDir: string): string;
}

export interface PackRunOptions {
    /** Test seam: inject a fake binding. Defaults to the loaded N-API addon. */
    binding?: PackNativeBinding;
}

/** Error carrying the full diagnostic set — never swallowed, never summarized away. */
export class PackNativeError extends Error {
    readonly code: string;
    readonly diagnostics: PackDiagnostic[];

    constructor(code: string, message: string, diagnostics: PackDiagnostic[] = []) {
        super(`[${code}] ${message}`);
        this.name = 'PackNativeError';
        this.code = code;
        this.diagnostics = diagnostics;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestInvalid(message: string): PackNativeError {
    return new PackNativeError('pack.native.request-invalid', message);
}

function responseShape(message: string): PackNativeError {
    return new PackNativeError('pack.native.response-shape', message);
}

function requireString(value: unknown, where: string): string {
    if (typeof value !== 'string') throw responseShape(`${where} must be a string`);
    return value;
}

function requireStringArray(value: unknown, where: string): string[] {
    if (!Array.isArray(value)) throw responseShape(`${where} must be an array of strings`);
    return value.map((item, i) => requireString(item, `${where}[${i}]`));
}

/** Contract mirror: fields outside the frozen shape are rejected, not ignored. */
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
    const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
    if (extra.length) throw responseShape(`${where} has unknown field(s): ${extra.join(', ')}`);
}

function parsePackDiagnostic(value: unknown, where: string): PackDiagnostic {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(value, ['code', 'message', 'path', 'span'], where);
    const out: PackDiagnostic = {
        code: requireString(value.code, `${where}.code`),
        message: requireString(value.message, `${where}.message`),
    };
    if (value.path !== undefined) out.path = requireString(value.path, `${where}.path`);
    if (value.span !== undefined) {
        if (
            !Array.isArray(value.span) ||
            value.span.length !== 2 ||
            !value.span.every((n) => typeof n === 'number' && Number.isFinite(n))
        ) {
            throw responseShape(`${where}.span must be [number, number]`);
        }
        out.span = [value.span[0] as number, value.span[1] as number];
    }
    return out;
}

function parseChunkArtifact(value: unknown, where: string): PackChunkArtifact {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(
        value,
        ['chunkId', 'fileName', 'code', 'modules', 'imports', 'dynamic', 'sourceMapFileName'],
        where,
    );
    return {
        chunkId: requireString(value.chunkId, `${where}.chunkId`),
        fileName: requireString(value.fileName, `${where}.fileName`),
        code: requireString(value.code, `${where}.code`),
        modules: requireStringArray(value.modules, `${where}.modules`),
        imports: requireStringArray(value.imports, `${where}.imports`),
        dynamic: requireStringArray(value.dynamic, `${where}.dynamic`),
        sourceMapFileName: requireString(value.sourceMapFileName, `${where}.sourceMapFileName`),
    };
}

function parseAssetArtifact(value: unknown, where: string): PackAssetArtifact {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(value, ['modulePath', 'specifier', 'fileName', 'url', 'sourcePath'], where);
    return {
        modulePath: requireString(value.modulePath, `${where}.modulePath`),
        specifier: requireString(value.specifier, `${where}.specifier`),
        fileName: requireString(value.fileName, `${where}.fileName`),
        url: requireString(value.url, `${where}.url`),
        sourcePath: requireString(value.sourcePath, `${where}.sourcePath`),
    };
}

function parseStyleArtifact(value: unknown, where: string): PackStyleArtifact {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(value, ['fileName', 'url', 'modules', 'sourcePaths'], where);
    return {
        fileName: requireString(value.fileName, `${where}.fileName`),
        url: requireString(value.url, `${where}.url`),
        modules: requireStringArray(value.modules, `${where}.modules`),
        sourcePaths: requireStringArray(value.sourcePaths, `${where}.sourcePaths`),
    };
}

function parseEntryFile(value: unknown, where: string): PackEntryFile {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(value, ['logical', 'file'], where);
    return { logical: requireString(value.logical, `${where}.logical`), file: requireString(value.file, `${where}.file`) };
}

function parseDynamicFile(value: unknown, where: string): PackDynamicFile {
    if (!isPlainObject(value)) throw responseShape(`${where} must be an object`);
    rejectUnknownKeys(value, ['from', 'to'], where);
    return { from: requireString(value.from, `${where}.from`), to: requireString(value.to, `${where}.to`) };
}

function parsePackPlan(value: unknown): PackPlan {
    if (!isPlainObject(value)) throw responseShape('response.plan must be an object');
    rejectUnknownKeys(value, ['artifacts', 'styles', 'assets', 'entryFiles', 'dynamicFiles', 'manifestJson'], 'response.plan');
    if (!Array.isArray(value.artifacts)) throw responseShape('response.plan.artifacts must be an array');
    if (!Array.isArray(value.styles)) throw responseShape('response.plan.styles must be an array');
    if (!Array.isArray(value.assets)) throw responseShape('response.plan.assets must be an array');
    if (!Array.isArray(value.entryFiles)) throw responseShape('response.plan.entryFiles must be an array');
    if (!Array.isArray(value.dynamicFiles)) throw responseShape('response.plan.dynamicFiles must be an array');
    return {
        artifacts: value.artifacts.map((a, i) => parseChunkArtifact(a, `response.plan.artifacts[${i}]`)),
        styles: value.styles.map((s, i) => parseStyleArtifact(s, `response.plan.styles[${i}]`)),
        assets: value.assets.map((a, i) => parseAssetArtifact(a, `response.plan.assets[${i}]`)),
        entryFiles: value.entryFiles.map((e, i) => parseEntryFile(e, `response.plan.entryFiles[${i}]`)),
        dynamicFiles: value.dynamicFiles.map((d, i) => parseDynamicFile(d, `response.plan.dynamicFiles[${i}]`)),
        manifestJson: requireString(value.manifestJson, 'response.plan.manifestJson'),
    };
}

/**
 * Strictly parse one binding response. `ok:false` never returns — it throws a
 * `PackNativeError` carrying every diagnostic from the response.
 */
function parsePackResponse(raw: string): PackPlanResponseOk {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new PackNativeError('pack.native.response-json', `binding returned invalid JSON: ${msg}`);
    }
    if (!isPlainObject(parsed)) throw responseShape('response must be a JSON object');
    rejectUnknownKeys(parsed, ['ok', 'plan', 'diagnostics'], 'response');
    if (typeof parsed.ok !== 'boolean') throw responseShape('response.ok must be a boolean');
    if (!Array.isArray(parsed.diagnostics)) throw responseShape('response.diagnostics must be an array');
    const diagnostics = parsed.diagnostics.map((d, i) => parsePackDiagnostic(d, `response.diagnostics[${i}]`));
    if (parsed.ok === false) {
        if (parsed.plan !== undefined) throw responseShape('response.plan must be absent when ok is false');
        const summary = diagnostics.length
            ? diagnostics.map((d) => `${d.code}: ${d.message}`).join(' | ')
            : 'binding reported failure without diagnostics';
        throw new PackNativeError('pack.native.plan-failed', summary, diagnostics);
    }
    if (parsed.plan === undefined) throw responseShape('response.plan is required when ok is true');
    return { ok: true, plan: parsePackPlan(parsed.plan), diagnostics };
}

export interface BuildPackRequestInput {
    /** logical → absolute entry path. */
    entries: Record<string, string>;
    target: PackTarget;
    root: string;
    uses: PackRequestUse[];
    publicBase: string;
}

/** Assemble the request JSON. Every gap is an explicit error — nothing is guessed. */
export function buildPackRequest(input: BuildPackRequestInput): string {
    if (!isPlainObject(input as unknown)) throw requestInvalid('input must be an object');
    const logicals = Object.keys(input.entries ?? {});
    if (!logicals.length) throw requestInvalid('entries must contain at least one logical entry');
    const entries: PackRequestEntry[] = logicals.map((logical) => {
        const entryPath = input.entries[logical];
        if (typeof entryPath !== 'string' || !entryPath) {
            throw requestInvalid(`entries["${logical}"] must be a non-empty path string`);
        }
        if (!path.isAbsolute(entryPath)) {
            throw requestInvalid(`entries["${logical}"] must be an absolute path: ${entryPath}`);
        }
        return { logical, path: entryPath };
    });
    if (input.target !== 'browser' && input.target !== 'node') {
        throw new PackNativeError(
            'pack.native.request-target',
            `target must be "browser" or "node", got ${JSON.stringify(input.target)}`,
        );
    }
    if (typeof input.root !== 'string' || !input.root) throw requestInvalid('root must be a non-empty string');
    if (!path.isAbsolute(input.root)) throw requestInvalid(`root must be an absolute path: ${input.root}`);
    if (typeof input.publicBase !== 'string' || !input.publicBase) {
        throw requestInvalid('publicBase must be a non-empty string');
    }
    if (!Array.isArray(input.uses)) throw requestInvalid('uses must be an array');

    const useLogicals = new Set<string>();
    const uses: PackRequestUse[] = [];
    for (const use of input.uses) {
        if (!use || typeof use !== 'object' || typeof use.logical !== 'string' || !use.logical) {
            throw requestInvalid('uses[] items must be { logical, execution, exports } objects');
        }
        if (use.execution !== 'full' && use.execution !== 'side-effects') {
            throw new PackNativeError(
                'pack.native.request-uses',
                `uses["${use.logical}"].execution must be "full" or "side-effects", got ${JSON.stringify(use.execution)}`,
            );
        }
        const exports = use.exports;
        if (!exports || typeof exports !== 'object' || typeof exports.kind !== 'string') {
            throw new PackNativeError(
                'pack.native.request-uses',
                `uses["${use.logical}"].exports must be a tagged object { kind: "all" | "named" | "unconsumed" }`,
            );
        }
        if (exports.kind === 'named') {
            if (!Array.isArray(exports.names) || !exports.names.every((name) => typeof name === 'string' && name)) {
                throw new PackNativeError(
                    'pack.native.request-uses',
                    `uses["${use.logical}"].exports.names must be an array of non-empty export names`,
                );
            }
        } else if (exports.kind !== 'all' && exports.kind !== 'unconsumed') {
            throw new PackNativeError(
                'pack.native.request-uses',
                `uses["${use.logical}"].exports.kind must be "all", "named" or "unconsumed"`,
            );
        }
        if (useLogicals.has(use.logical)) {
            throw new PackNativeError('pack.native.request-uses', `uses duplicates logical "${use.logical}"`);
        }
        useLogicals.add(use.logical);
        uses.push({ logical: use.logical, execution: use.execution, exports: use.exports });
    }
    const missing = logicals.filter((logical) => !useLogicals.has(logical));
    if (missing.length) {
        throw new PackNativeError(
            'pack.native.request-uses',
            `uses must cover every entries[].logical — missing: ${missing.join(', ')}`,
        );
    }

    const request: PackRequest = { entries, target: input.target, root: input.root, uses, publicBase: input.publicBase };
    return JSON.stringify(request);
}

function resolveBinding(opts: PackRunOptions, fn: 'packPlan' | 'packWrite'): PackNativeBinding {
    const binding = (opts.binding ?? requireNativeAddon()) as Partial<PackNativeBinding>;
    if (typeof binding[fn] !== 'function') {
        throw new PackNativeError(
            'pack.native.binding-missing',
            `native binding missing ${fn} — run \`pnpm napi:build\` with a vmz-pack build`,
        );
    }
    return binding as PackNativeBinding;
}

/** Compute the pack plan via the native binding (synchronous, contract v0). */
export function runPackPlan(requestJson: string, opts: PackRunOptions = {}): PackPlanResponseOk {
    const binding = resolveBinding(opts, 'packPlan');
    return parsePackResponse(binding.packPlan(requestJson));
}

/** Compute the pack plan and write artifacts under `outDir` via the native binding. */
export function runPackWrite(requestJson: string, outDir: string, opts: PackRunOptions = {}): PackPlanResponseOk {
    if (typeof outDir !== 'string' || !outDir) throw requestInvalid('outDir must be a non-empty string');
    const binding = resolveBinding(opts, 'packWrite');
    return parsePackResponse(binding.packWrite(requestJson, outDir));
}

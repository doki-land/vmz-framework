/**
 * Library artifact emit (`vmz lib`): string-in / string-out native bridge.
 *
 * One request compiles a package's entry list into per-entry `<Name>.js` and
 * `<Name>.css`. The response shape is validated strictly: a missing field is a
 * hard error, never silently defaulted, so a partial artifact set cannot be
 * mistaken for success.
 */

import { requireNativeAddon } from './native-addon.js';

export interface LibraryCompileEntry {
    /** Artifact name: `<Name>.js` / `<Name>.css`. */
    name: string;
    /** Absolute path of the source `.vmz`. */
    path: string;
}

export interface LibraryCompileRequest {
    entries: LibraryCompileEntry[];
    /** Absolute artifact directory. */
    outDir: string;
    release?: boolean;
    /** `@vmz/core` dist directory; the compiler falls back to its own probe. */
    runtimeDist?: string;
}

export interface LibraryDiagnostic {
    severity: 'error' | 'warning' | 'advice';
    code: string;
    path: string;
    args?: Record<string, string>;
}

export interface LibraryCompileResult {
    ok: boolean;
    emitted: string[];
    diagnostics: LibraryDiagnostic[];
}

interface LibraryNativeBinding {
    libraryCompile(requestJson: string): string;
}

function shapeError(message: string): Error {
    return new Error(`[vmz.lib.response-shape] ${message}`);
}

function parseDiagnostic(value: unknown, where: string): LibraryDiagnostic {
    if (!value || typeof value !== 'object') throw shapeError(`${where} must be an object`);
    const record = value as Record<string, unknown>;
    const severity = String(record.severity ?? '');
    if (severity !== 'error' && severity !== 'warning' && severity !== 'advice') {
        throw shapeError(`${where}.severity must be error|warning|advice`);
    }
    if (typeof record.code !== 'string' || typeof record.path !== 'string') {
        throw shapeError(`${where}.code and ${where}.path must be strings`);
    }
    const args = record.args;
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        throw shapeError(`${where}.args must be an object of strings`);
    }
    return {
        severity,
        code: record.code,
        path: record.path,
        args: args === undefined ? undefined : (args as Record<string, string>),
    };
}

function parseResult(raw: string): LibraryCompileResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw shapeError(`binding returned invalid JSON: ${message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw shapeError('response must be an object');
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.ok !== 'boolean') throw shapeError('response.ok must be a boolean');
    if (!Array.isArray(record.emitted) || !record.emitted.every((item) => typeof item === 'string')) {
        throw shapeError('response.emitted must be an array of strings');
    }
    if (!Array.isArray(record.diagnostics)) throw shapeError('response.diagnostics must be an array');
    return {
        ok: record.ok,
        emitted: record.emitted as string[],
        diagnostics: record.diagnostics.map((item, index) =>
            parseDiagnostic(item, `diagnostics[${index}]`),
        ),
    };
}

export function runLibraryCompile(request: LibraryCompileRequest): LibraryCompileResult {
    if (!Array.isArray(request.entries) || request.entries.length === 0) {
        throw new Error('[vmz.lib.request] entries must not be empty');
    }
    const binding = requireNativeAddon() as Partial<LibraryNativeBinding>;
    if (typeof binding.libraryCompile !== 'function') {
        throw new Error('[vmz.lib.binding-missing] rebuild the N-API addon (libraryCompile unavailable)');
    }
    return parseResult(binding.libraryCompile(JSON.stringify(request)));
}

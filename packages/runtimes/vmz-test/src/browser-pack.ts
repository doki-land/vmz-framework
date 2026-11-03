/**
 * Direct browser harness packing for `vmz test --mode browser`.
 *
 * The Direct harness serves raw compiler output (`<chunkId>.client.js`) over a
 * static file server. Those artifacts keep bare package imports (e.g.
 * `@vmz/ui-icons/registry` inside `@vmz/ui` components) that a browser cannot
 * resolve — the `dist/vendor/**` lowering that used to rewrite them is retired.
 * The harness therefore packs the tested component chain through the Rust
 * `vmz-pack` N-API binding (browser target) before mounting, and the page loads
 * the packed entry chunks from `_vmz/pack-test/` instead of the raw artifacts.
 *
 * The wire shape below is the minimal test-host slice of the frozen v0 pack
 * contract (`packWrite(requestJson, outDir)` → response JSON with
 * `plan.entryFiles`); no new contract fields are introduced here.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** `uses[]` item, mirroring the Rust `EntryExecution` / `EntryExports` wire. */
interface PackRequestUse {
    logical: string;
    execution: 'full' | 'side-effects';
    exports: { kind: 'all' } | { kind: 'named'; names: string[] } | { kind: 'unconsumed' };
}

interface PackEntryFile {
    logical: string;
    file: string;
}

/** The single N-API function this host consumes. */
interface PackNativeBinding {
    packWrite(requestJson: string, outDir: string): string;
}

/** Directory (relative to outDir) where the harness pack is written. */
const PACK_TEST_OUTPUT_DIR_REL = '_vmz/pack-test';

let cached: PackNativeBinding | null | undefined;

/**
 * Same native addon loading as the test host serve path: `VMZ_NATIVE_NODE`
 * override first, then `@vmz/vmz-<short>` package resolution, then the
 * workspace sibling layout. This host must not import the CLI package's
 * internal modules, so the discovery is mirrored here.
 */
function tryLoadPackBinding(): PackNativeBinding | null {
    if (cached !== undefined) return cached;
    try {
        const envPath = (typeof process.env.VMZ_NATIVE_NODE === 'string' && process.env.VMZ_NATIVE_NODE.trim()) || '';
        if (envPath) {
            cached = require(path.resolve(envPath)) as PackNativeBinding;
            return cached;
        }
        const { platform, arch } = process;
        let triple = `${platform}-${arch}`;
        if (platform === 'win32' && arch === 'x64') triple = 'win32-x64-msvc';
        else if (platform === 'win32' && arch === 'arm64') triple = 'win32-arm64-msvc';
        else if (platform === 'darwin' && arch === 'arm64') triple = 'darwin-arm64';
        else if (platform === 'darwin' && arch === 'x64') triple = 'darwin-x64';
        else if (platform === 'linux' && arch === 'x64') triple = 'linux-x64-gnu';
        else if (platform === 'linux' && arch === 'arm64') triple = 'linux-arm64-gnu';
        const short =
            triple === 'win32-x64-msvc'
                ? 'win32-x64'
                : triple === 'win32-arm64-msvc'
                  ? 'win32-arm64'
                  : triple === 'linux-x64-gnu'
                    ? 'linux-x64'
                    : triple === 'linux-arm64-gnu'
                      ? 'linux-arm64'
                      : triple;
        const name = `@vmz/vmz-${short}`;
        const candidates: string[] = [];
        try {
            const resolved = require.resolve(`${name}/package.json`);
            const dir = path.dirname(resolved);
            candidates.push(path.join(dir, `vmz.${triple}.node`), path.join(dir, 'vmz.node'));
        } catch {
            /* optional dep missing */
        }
        const here = path.dirname(fileURLToPath(import.meta.url));
        candidates.push(
            path.join(here, '..', '..', '..', 'runtimes', `vmz-${short}`, `vmz.${triple}.node`),
            path.join(here, '..', '..', '..', 'runtimes', `vmz-${short}`, 'vmz.node'),
        );
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                cached = require(p) as PackNativeBinding;
                return cached;
            }
        }
        cached = null;
    } catch {
        cached = null;
    }
    return cached;
}

function requirePackBinding(): PackNativeBinding {
    const binding = tryLoadPackBinding();
    if (!binding || typeof binding.packWrite !== 'function') {
        throw new Error('browser harness pack: vmz native addon with packWrite missing — run `pnpm napi:build`');
    }
    return binding;
}

/** Minimal response read: `ok:false` throws with every diagnostic, `plan.entryFiles` is the only payload consumed. */
function parsePackEntryFiles(raw: string): PackEntryFile[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`browser harness pack: binding returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { ok?: unknown }).ok !== 'boolean') {
        throw new Error('browser harness pack: response must be an object with boolean ok');
    }
    const resp = parsed as {
        ok: boolean;
        plan?: { entryFiles?: unknown };
        diagnostics?: Array<{ code?: unknown; message?: unknown }>;
    };
    const diagnostics = Array.isArray(resp.diagnostics) ? resp.diagnostics : [];
    if (resp.ok === false) {
        const summary = diagnostics.length
            ? diagnostics.map((d) => `${String(d?.code ?? '')}: ${String(d?.message ?? '')}`).join(' | ')
            : 'binding reported failure without diagnostics';
        throw new Error(`browser harness pack failed: ${summary}`);
    }
    const entryFiles = resp.plan?.entryFiles;
    if (!Array.isArray(entryFiles)) {
        throw new Error('browser harness pack: response plan.entryFiles must be an array');
    }
    return entryFiles.map((e, i) => {
        const item = e as { logical?: unknown; file?: unknown };
        if (typeof item?.logical !== 'string' || !item.logical || typeof item?.file !== 'string' || !item.file) {
            throw new Error(`browser harness pack: response plan.entryFiles[${i}] must have string logical and file`);
        }
        return { logical: item.logical, file: item.file };
    });
}

/**
 * Pack the direct-harness component set (tested chunk + registry closure) for
 * the browser target into `<outDir>/_vmz/pack-test`. Returns logical chunkId →
 * packed entry file relative to the pack output dir. A missing client entry or
 * a logical absent from the plan is an explicit error — never a silent skip.
 */
export function packHarnessComponents(outDir: string, chunkIds: string[]): Map<string, string> {
    const absOut = path.resolve(outDir);
    const depPath = path.join(absOut, 'vmz-deployment.json');
    if (!fs.existsSync(depPath)) {
        throw new Error(`browser harness pack: missing ${depPath} (run vmz build first)`);
    }
    const dep = JSON.parse(fs.readFileSync(depPath, 'utf8')) as {
        units?: Array<{ chunkId?: string; clientEntry?: string; source?: string }>;
    };
    const units = new Map<string, { clientEntry: string; source: string }>();
    for (const unit of Array.isArray(dep.units) ? dep.units : []) {
        const chunkId = String(unit?.chunkId || '').replace(/\\/g, '/');
        if (!chunkId || units.has(chunkId)) continue;
        units.set(chunkId, {
            clientEntry: (unit.clientEntry ? String(unit.clientEntry) : `${chunkId}.client.js`).replace(/\\/g, '/'),
            source: String(unit.source || ''),
        });
    }

    const logicals = [...new Set(chunkIds.map((id) => String(id).replace(/\\/g, '/')).filter((id) => id))];
    const entries: Array<{ logical: string; path: string }> = [];
    const uses: PackRequestUse[] = [];
    for (const logical of logicals) {
        const clientEntry = units.get(logical)?.clientEntry ?? `${logical}.client.js`;
        const abs = path.join(absOut, ...clientEntry.split('/'));
        if (!fs.existsSync(abs)) {
            throw new Error(`browser harness pack: client entry missing for "${logical}": ${clientEntry} (in ${absOut})`);
        }
        entries.push({ logical, path: abs });
        uses.push({ logical, execution: 'full', exports: { kind: 'all' } });
    }

    // Projection provenance (same semantics as `deploymentUnitOrigins`): emitted
    // realpath → source realpath, only when both sides exist. Bare-specifier
    // package discovery walks up from the source location.
    const origins: Record<string, string> = {};
    for (const { clientEntry, source } of units.values()) {
        if (!source) continue;
        const emitted = path.join(absOut, ...clientEntry.split('/'));
        if (!fs.existsSync(emitted) || !fs.existsSync(source)) continue;
        origins[fs.realpathSync(emitted)] = fs.realpathSync(source);
    }

    const request = {
        entries,
        target: 'browser',
        root: path.dirname(absOut),
        uses,
        publicBase: '/',
        ...(Object.keys(origins).length ? { origins } : {}),
    };
    const packOutDir = path.join(absOut, ...PACK_TEST_OUTPUT_DIR_REL.split('/'));
    // `packWrite` only adds files — clear the previous harness pack so stale
    // chunks from an older build can never be served.
    fs.rmSync(packOutDir, { recursive: true, force: true });
    const response = requirePackBinding().packWrite(JSON.stringify(request), packOutDir);
    const byLogical = new Map(parsePackEntryFiles(response).map((e) => [e.logical, e.file]));
    const missing = logicals.filter((logical) => !byLogical.has(logical));
    if (missing.length) {
        throw new Error(`browser harness pack: plan has no entry file for: ${missing.join(', ')}`);
    }
    return byLogical;
}

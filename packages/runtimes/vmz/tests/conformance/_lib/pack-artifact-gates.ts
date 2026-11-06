/**
 * Pack artifact gates — shared assertions over a built site dist.
 *
 * These turn "the output should have what it should and nothing else" into
 * executable checks over `_vmz/pack/` + `_vmz/pack-manifest.json`:
 * manifest/disk closure, import reference integrity, per-module uniqueness,
 * route chunk boundaries, deterministic rebuilds, and byte budgets.
 *
 * Every walker and scanner is bounded (explicit caps, zero-progress guards).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PACK_MANIFEST_SCHEMA = 'vmz.pack.manifest.v0';
/** Hard caps keep every scan finite even on a corrupt or hostile tree. */
export const SCAN_LIMITS = { maxFiles: 4000, maxDepth: 24, maxCodeBytes: 8 * 1024 * 1024, maxSpecifiers: 4000 };

export interface PackChunkRow {
    chunkId: string;
    fileName: string;
    modules: string[];
    bytes: number;
    digest: string;
    sourceMap?: string;
}

export interface PackManifest {
    schema: string;
    chunkCount: number;
    chunks: PackChunkRow[];
    entryFiles: Array<{ logical: string; file: string }>;
    dynamicFiles: Array<{ from: string; to: string }>;
    packDigest: string;
}

export interface LoadedPack {
    dist: string;
    packDir: string;
    manifest: PackManifest;
    /** relative (posix) file name → bytes, JS chunks and maps only. */
    tree: Map<string, Buffer>;
}

export function sha256Hex(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/** Bounded recursive listing of `_vmz/pack` — JS chunks and their maps. */
export function listPackTree(packDir: string): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    if (!fs.existsSync(packDir)) return out;
    const stack: Array<{ abs: string; rel: string; depth: number }> = [{ abs: packDir, rel: '', depth: 0 }];
    let steps = 0;
    while (stack.length > 0) {
        if (++steps > SCAN_LIMITS.maxFiles * 2) throw new Error(`pack tree walk exceeded ${SCAN_LIMITS.maxFiles * 2} steps`);
        const { abs, rel, depth } = stack.pop()!;
        if (depth > SCAN_LIMITS.maxDepth) throw new Error(`pack tree walk exceeded depth ${SCAN_LIMITS.maxDepth}`);
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            const childAbs = path.join(abs, entry.name);
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                stack.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
                continue;
            }
            if (out.size >= SCAN_LIMITS.maxFiles) throw new Error(`pack tree exceeds ${SCAN_LIMITS.maxFiles} files`);
            out.set(childRel, fs.readFileSync(childAbs));
        }
    }
    return out;
}

/** Load `_vmz/pack-manifest.json` + the `_vmz/pack` tree. Returns errors instead of throwing. */
export function loadPack(dist: string): { ok: true; value: LoadedPack } | { ok: false; errors: string[] } {
    const manifestPath = path.join(dist, '_vmz', 'pack-manifest.json');
    if (!fs.existsSync(manifestPath)) return { ok: false, errors: [`missing ${manifestPath}`] };
    let manifest: PackManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackManifest;
    } catch (error) {
        return { ok: false, errors: [`pack-manifest.json is not valid JSON: ${error}`] };
    }
    const packDir = path.join(dist, '_vmz', 'pack');
    return { ok: true, value: { dist, packDir, manifest, tree: listPackTree(packDir) } };
}

/**
 * Manifest/disk closure: every manifest chunk file exists on disk with a
 * matching digest and byte count; every chunk JS on disk is named by the
 * manifest; every chunk map exists. Nothing extra, nothing missing.
 */
export function assertManifestClosed(pack: LoadedPack): string[] {
    const errors: string[] = [];
    const { manifest, tree } = pack;
    if (manifest.schema !== PACK_MANIFEST_SCHEMA) errors.push(`pack manifest schema=${String(manifest.schema)}`);
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
        errors.push('pack manifest chunks empty');
        return errors;
    }
    const claimedJs = new Set<string>();
    const claimedMaps = new Set<string>();
    const seenIds = new Set<string>();
    for (const chunk of manifest.chunks) {
        if (seenIds.has(chunk.chunkId)) errors.push(`duplicate chunkId ${chunk.chunkId}`);
        seenIds.add(chunk.chunkId);
        claimedJs.add(chunk.fileName);
        if (chunk.sourceMap) claimedMaps.add(chunk.sourceMap);
        const bytes = tree.get(chunk.fileName);
        if (!bytes) {
            errors.push(`chunk ${chunk.chunkId} file ${chunk.fileName} missing on disk`);
            continue;
        }
        if (bytes.length !== chunk.bytes) {
            errors.push(`chunk ${chunk.chunkId} bytes manifest=${chunk.bytes} disk=${bytes.length}`);
        }
        const digest = sha256Hex(bytes);
        if (digest !== chunk.digest) {
            errors.push(`chunk ${chunk.chunkId} digest mismatch manifest=${chunk.digest} disk=${digest}`);
        }
        if (chunk.sourceMap && !tree.has(chunk.sourceMap)) {
            errors.push(`chunk ${chunk.chunkId} map ${chunk.sourceMap} missing on disk`);
        }
    }
    for (const [rel] of tree) {
        if (rel === 'manifest.json') continue;
        if (rel.endsWith('.js') && !claimedJs.has(rel)) errors.push(`disk chunk ${rel} not in manifest`);
        if (rel.endsWith('.js.map') && !claimedMaps.has(rel)) errors.push(`disk map ${rel} not in manifest`);
    }
    const chunkFiles = new Set(manifest.chunks.map((c) => c.fileName));
    for (const entry of manifest.entryFiles ?? []) {
        if (!chunkFiles.has(entry.file)) errors.push(`entryFiles ${entry.logical} → ${entry.file} not a chunk`);
    }
    for (const edge of manifest.dynamicFiles ?? []) {
        if (!chunkFiles.has(edge.from)) errors.push(`dynamicFiles from ${edge.from} not a chunk`);
        if (!chunkFiles.has(edge.to)) errors.push(`dynamicFiles to ${edge.to} not a chunk`);
    }
    return errors;
}

/**
 * Extract module specifiers consumed by import/export syntax in emitted code.
 * Only machine shapes are recognized: an identifier `from` / `import` followed
 * by a quoted string with nothing but whitespace (or one `(` for the call
 * form) between them. Strings, templates, and comments are opaque.
 */
export function importSpecifiers(code: string): string[] {
    const out: string[] = [];
    const chars = code;
    let index = 0;
    let lastIdent: string | null = null;
    let identIsMember = false;
    let between = '';
    let lineComment = false;
    let blockComment = false;
    const n = chars.length;
    while (index < n) {
        if (out.length > SCAN_LIMITS.maxSpecifiers) throw new Error('specifier scan exceeded cap');
        const ch = chars[index];
        const next = index + 1 < n ? chars[index + 1] : '';
        if (lineComment) {
            if (ch === '\n') lineComment = false;
            index += 1;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') {
                blockComment = false;
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if (ch === '/' && next === '/') {
            lineComment = true;
            index += 2;
            continue;
        }
        if (ch === '/' && next === '*') {
            blockComment = true;
            index += 2;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            const takes =
                !identIsMember &&
                (lastIdent === 'from' || (lastIdent === 'import' && (between.trim() === '' || between.trim() === '(')));
            const quote = ch;
            let cursor = index + 1;
            let text = '';
            let guard = 0;
            while (cursor < n) {
                if (++guard > SCAN_LIMITS.maxCodeBytes) throw new Error('string scan exceeded cap');
                const inner = chars[cursor];
                if (inner === '\\') {
                    cursor += 2;
                    continue;
                }
                if (inner === quote) break;
                text += inner;
                cursor += 1;
            }
            if (takes && quote !== '`') out.push(text);
            index = cursor + 1;
            lastIdent = null;
            identIsMember = false;
            between = '';
            continue;
        }
        if (/[A-Za-z_$]/.test(ch)) {
            identIsMember = index > 0 && chars[index - 1] === '.';
            let cursor = index;
            while (cursor < n && /[A-Za-z0-9_$]/.test(chars[cursor])) cursor += 1;
            lastIdent = chars.slice(index, cursor);
            between = '';
            index = cursor;
            continue;
        }
        if (lastIdent !== null) {
            between += ch;
            if (between.length > 8) {
                lastIdent = null;
                between = '';
            }
        }
        index += 1;
    }
    return out;
}

/**
 * Reference integrity: every relative specifier in every emitted chunk
 * resolves to a real file in the pack tree; root-absolute specifiers
 * (`/dom.browser.js` style runtime URLs kept verbatim by the delivery layer)
 * must exist under the dist root; bare package specifiers never survive.
 */
export function assertReferenceIntegrity(pack: LoadedPack): string[] {
    const errors: string[] = [];
    for (const chunk of pack.manifest.chunks) {
        const bytes = pack.tree.get(chunk.fileName);
        if (!bytes) continue;
        if (bytes.length > SCAN_LIMITS.maxCodeBytes) {
            errors.push(`chunk ${chunk.chunkId} exceeds code scan cap`);
            continue;
        }
        const code = bytes.toString('utf8');
        for (const specifier of importSpecifiers(code)) {
            if (specifier.startsWith('./')) {
                const key = specifier.slice(2);
                if (!pack.tree.has(key)) {
                    errors.push(`${chunk.fileName}: import \`${specifier}\` resolves to missing pack file`);
                }
                continue;
            }
            if (specifier.startsWith('/')) {
                const onDisk = path.join(pack.dist, ...specifier.split('/').filter(Boolean));
                if (!fs.existsSync(onDisk)) {
                    errors.push(`${chunk.fileName}: import \`${specifier}\` resolves to missing dist file`);
                }
                continue;
            }
            if (specifier.startsWith('node:')) {
                // `vmz::pack::resolve::node_builtin_external` 合同形态：动态
                // `import("node:…")` 原样保留，仅在 Node 宿主求值分支内执行；
                // 计划内客户端模块的静态 `node:` 导入在 plan 期已被
                // `node_builtin_static_unsupported` 拒绝。
                continue;
            }
            errors.push(`${chunk.fileName}: bare specifier \`${specifier}\` survived emit`);
        }
    }
    return errors;
}

/** Each source module lives in exactly one chunk — no silent duplication. */
export function assertModulesUnique(pack: LoadedPack): string[] {
    const errors: string[] = [];
    const owner = new Map<string, string>();
    for (const chunk of pack.manifest.chunks) {
        for (const module of chunk.modules) {
            const prev = owner.get(module);
            if (prev) errors.push(`module ${module} in both ${prev} and ${chunk.chunkId}`);
            else owner.set(module, chunk.chunkId);
        }
    }
    return errors;
}

/**
 * Nested SSR delivery imports: the assembler relocates runtime copies into
 * `ssr/`, so every relative import there must resolve inside the dist rather
 * than through the source-tree `shared/` layout. Walk is bounded by
 * [`SCAN_LIMITS`].
 */
export function assertNestedSsrImportsResolve(dist: string, subdir = 'ssr'): string[] {
    const errors: string[] = [];
    const dir = path.join(dist, subdir);
    if (!fs.existsSync(dir)) return [`missing nested SSR directory \`${subdir}\``];
    const stack: Array<{ abs: string; depth: number }> = [{ abs: dir, depth: 0 }];
    let files = 0;
    while (stack.length) {
        const item = stack.pop()!;
        if (item.depth > SCAN_LIMITS.maxDepth) {
            errors.push(`${subdir}: directory depth exceeds scan cap`);
            continue;
        }
        for (const entry of fs.readdirSync(item.abs, { withFileTypes: true })) {
            const abs = path.join(item.abs, entry.name);
            if (entry.isDirectory()) {
                stack.push({ abs, depth: item.depth + 1 });
                continue;
            }
            if (!entry.isFile() || !/\.(?:js|mjs)$/.test(entry.name)) continue;
            files += 1;
            if (files > SCAN_LIMITS.maxFiles) {
                errors.push(`${subdir}: file count exceeds scan cap`);
                return errors;
            }
            const bytes = fs.readFileSync(abs);
            if (bytes.length > SCAN_LIMITS.maxCodeBytes) {
                errors.push(`${path.relative(dist, abs)}: exceeds code scan cap`);
                continue;
            }
            const code = bytes.toString('utf8');
            for (const specifier of importSpecifiers(code)) {
                if (!specifier.startsWith('.')) continue;
                const target = path.resolve(path.dirname(abs), specifier.split(/[?#]/)[0]);
                if (!fs.existsSync(target)) {
                    errors.push(`${path.relative(dist, abs)}: import \`${specifier}\` resolves to missing file`);
                }
            }
        }
    }
    return errors;
}

/**
 * Route boundaries: every expected page owns a non-entry chunk that carries
 * its compiled client module; entry chunks contain no page module and reach
 * pages only through dynamic imports.
 */
export function assertRouteBoundaries(
    pack: LoadedPack,
    opts: { pages: string[] },
): string[] {
    const errors: string[] = [];
    const entryChunks = pack.manifest.chunks.filter((c) => c.chunkId.startsWith('entry/'));
    const asyncChunks = pack.manifest.chunks.filter((c) => !c.chunkId.startsWith('entry/'));
    for (const page of opts.pages) {
        const needle = `${page}.client.js`;
        const owner = asyncChunks.find((c) => c.modules.some((m) => m.replace(/\\/g, '/').endsWith(`/${needle}`) || m.replace(/\\/g, '/').endsWith(needle)));
        if (!owner) {
            errors.push(`page ${page} has no non-entry chunk carrying ${needle}`);
            continue;
        }
        for (const entry of entryChunks) {
            if (entry.modules.some((m) => m.replace(/\\/g, '/').endsWith(needle))) {
                errors.push(`entry chunk ${entry.chunkId} statically contains page module ${needle}`);
            }
            const code = pack.tree.get(entry.fileName)?.toString('utf8') ?? '';
            if (code.includes(`from "./${owner.fileName}"`)) {
                errors.push(`entry chunk ${entry.chunkId} statically imports page chunk ${owner.fileName}`);
            }
        }
    }
    return errors;
}

/** Snapshot of the pack tree for determinism comparison. */
export interface PackSnapshot {
    names: string[];
    digests: Map<string, string>;
    packDigest: string;
}

export function snapshotPack(pack: LoadedPack): PackSnapshot {
    const names = [...pack.tree.keys()].sort();
    const digests = new Map<string, string>();
    for (const [rel, bytes] of pack.tree) digests.set(rel, sha256Hex(bytes));
    return { names, digests, packDigest: pack.manifest.packDigest };
}

export function assertSamePackSnapshot(a: PackSnapshot, b: PackSnapshot): string[] {
    const errors: string[] = [];
    if (a.names.join('\n') !== b.names.join('\n')) {
        const onlyA = a.names.filter((n) => !b.names.includes(n)).slice(0, 10);
        const onlyB = b.names.filter((n) => !a.names.includes(n)).slice(0, 10);
        errors.push(`pack file sets differ (only first=${onlyA.join(',')}, only second=${onlyB.join(',')})`);
        return errors;
    }
    for (const name of a.names) {
        if (a.digests.get(name) !== b.digests.get(name)) errors.push(`byte drift in ${name}`);
    }
    if (a.packDigest !== b.packDigest) errors.push(`packDigest drift ${a.packDigest} → ${b.packDigest}`);
    return errors;
}

/**
 * Byte budgets: per-entry and per-async chunk caps plus a total JS cap.
 * The fixture is tiny, so tight caps are honest guards, not noise.
 */
export function assertBudgets(
    pack: LoadedPack,
    opts: { maxEntryChunkBytes: number; maxAsyncChunkBytes: number; maxTotalJsBytes: number },
): string[] {
    const errors: string[] = [];
    let total = 0;
    for (const chunk of pack.manifest.chunks) {
        total += chunk.bytes;
        if (chunk.chunkId.startsWith('entry/') && chunk.bytes > opts.maxEntryChunkBytes) {
            errors.push(`entry chunk ${chunk.chunkId} ${chunk.bytes}B > ${opts.maxEntryChunkBytes}B`);
        }
        if (chunk.chunkId.startsWith('async/') && chunk.bytes > opts.maxAsyncChunkBytes) {
            errors.push(`async chunk ${chunk.chunkId} ${chunk.bytes}B > ${opts.maxAsyncChunkBytes}B`);
        }
    }
    if (total > opts.maxTotalJsBytes) errors.push(`total pack JS ${total}B > ${opts.maxTotalJsBytes}B`);
    return errors;
}

/** Assert a marker string appears in exactly `times` chunks across the tree. */
export function countChunksContaining(pack: LoadedPack, marker: string): string[] {
    const holders: string[] = [];
    for (const chunk of pack.manifest.chunks) {
        const code = pack.tree.get(chunk.fileName)?.toString('utf8') ?? '';
        if (code.includes(marker)) holders.push(chunk.chunkId);
    }
    return holders;
}

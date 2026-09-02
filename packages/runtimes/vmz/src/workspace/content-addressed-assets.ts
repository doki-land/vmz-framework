/**
 * A3: content-addressed assets/<hash> layout for immutable CDN objects.
 * Logical paths stay available for serve/dev. Static HTML must receive hashed
 * `cssEntry` / `moduleScriptSrc` at shell emit time — this module does **not**
 * post-rewrite HTML. CSS aggregators rewrite `@import` before hash. JS under
 * `assets/` rewrites ESM `./` → `../` via oxc (plus dynamic `import("./"+)` form)
 * so barrels resolve at dist root.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireNativeAddon } from './native-addon.js';
import { canonicalJson, sha256Hex } from './release-pack.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const CONTENT_ADDRESSED_ASSETS_SCHEMA = 'vmz.content_addressed_assets.v0';
export const ASSET_PLAN_SCHEMA = 'vmz.asset.plan.v0';

interface ContentAddressedAssetObject {
    logicalPath: string;
    assetPath: string;
    digest: string;
    bytes: number;
    immutable: boolean;
}

export interface ContentAddressedAssetsManifest {
    schema: string;
    layout: string;
    immutable: boolean;
    objectCount: number;
    objects: ContentAddressedAssetObject[];
    rewrittenHtml: number;
    manifestDigest?: string;
}

interface EmitContentAddressedAssetsOpts {
    candidates?: string[];
}

interface IngestCandidateOpts {
    transform?: ((buf: Buffer) => Buffer) | null;
}

/** Immutable delivery candidates (client-facing bytes). */
const DEFAULT_CANDIDATES = [
    'entry-client.js',
    'entry-event.js',
    'vmz.css',
    'vmz-designs.css',
    'vmz-style.css',
    'vmz-dom.js',
    'vmz-runtime.js',
    'vmz-http.js',
    'vmz-client-nav.js',
];

/** CSS files that may @import other logical CSS; processed after leaf CSS is hashed. */
const CSS_AGGREGATORS = new Set(['vmz.css']);

/** JS entry shells hashed under assets/; relative ESM must be rewritten first. */
const JS_ENTRY_AGGREGATORS = new Set(['entry-client.js', 'entry-event.js']);

const CSS_IMPORT_RE = /@import\s*(?:url\()?['"]?(\.\/)?([^'")\s;]+)['"]?\)?/gi;

/**
 * Rewrite relative `@import "./foo.css"` to hashed paths under assets/.
 * @param {string} cssText
 * @param {Record<string, string>} rewrites logical (no leading slash) or `/logical` → `assets/hash.ext`
 */
export function rewriteCssImports(cssText, rewrites) {
    return cssText.replace(CSS_IMPORT_RE, (match, _dot, target) => {
        const logical = String(target || '').replace(/^\.\//, '');
        if (!logical) return match;
        const hashed = rewrites[logical] || rewrites[`/${logical}`] || rewrites[`assets/${logical}`];
        if (!hashed) return match;
        const rel = hashed.startsWith('/') ? hashed.slice(1) : hashed;
        const sibling = rel.startsWith('assets/') ? `./${path.basename(rel)}` : `./${rel}`;
        return `@import"${sibling}"`;
    });
}

/**
 * Rewrite relative ESM so a file served from `/assets/<hash>.js` resolves against
 * dist root (static `from "./x"` / `export * from "./x"` + dynamic `import("./"+…)`).
 *
 * Always use `../…` (Fix A). Do **not** prefer hashed siblings under `assets/`:
 * barrels like `vmz-dom.js` (`export * from './dom-core.js'`) would then resolve
 * as `/assets/dom-core.js` and 404. `rewrites` is accepted for API parity with CSS
 * but intentionally ignored for JS path choice.
 *
 * @param {string} jsText
 * @param {Record<string, string>} [_rewrites]
 */
export function rewriteJsEntryRelativeImports(jsText, _rewrites = {}) {
    const native = requireNativeAddon();
    if (typeof native.rewriteModuleSpecifiers !== 'function') {
        throw new Error('native missing rewriteModuleSpecifiers — run `pnpm napi:build`');
    }
    // Static import/export specs via oxc AST (`./x` → `../x`). Dynamic
    // `import("./"+id)` is not a literal specifier — rewrite that codegen form only.
    let out = String(
        native.rewriteModuleSpecifiers(
            String(jsText ?? ''),
            JSON.stringify({
                tsExtToJs: false,
                dotSlashToParent: true,
            }),
        ),
    );
    out = out.replace(/import\(\s*"\.\/"\s*\+/g, 'import("../"+');
    out = out.replace(/import\(\s*'\.\/'\s*\+/g, "import('../'+");
    return out;
}

/**
 * Emit `assets/<sha256>.<ext>` copies and return logical→hashed rewrites.
 * Callers must pass hashed URLs into `generatePageShell` — HTML is never rewritten here.
 * @param {string} distDir
 * @param {{ candidates?: string[] }} [opts]
 */
export function emitContentAddressedAssets(distDir: string, opts: EmitContentAddressedAssetsOpts = {}) {
    const abs = path.resolve(distDir);
    if (!fs.existsSync(abs)) {
        throw new Error(`emitContentAddressedAssets: missing dist ${abs}`);
    }
    const assetsDir = path.join(abs, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const candidates = Array.isArray(opts.candidates) ? opts.candidates : collectCandidates(abs);
    const objects: ContentAddressedAssetObject[] = [];
    const rewrites: Record<string, string> = {};

    const ordered = orderCandidates(candidates);
    const vmzMetaDir = path.join(abs, '_vmz');
    fs.mkdirSync(vmzMetaDir, { recursive: true });
    writePrettyJsonFile(path.join(vmzMetaDir, 'asset-plan.json'), {
        schema: ASSET_PLAN_SCHEMA,
        layout: 'assets/<sha256>.<ext>',
        immutable: true,
        candidates: ordered,
    });

    for (const rel of ordered) {
        // Aggregators are replaced in later passes; leaf JS must rewrite ./ → ../ so a
        // hashed barrel under assets/ never 404s on second-hop relative re-exports.
        if (CSS_AGGREGATORS.has(rel) || JS_ENTRY_AGGREGATORS.has(rel)) {
            ingestCandidate(abs, rel, rewrites, objects, { transform: null });
            continue;
        }
        if (/\.m?js$/i.test(rel)) {
            const src = path.join(abs, rel);
            if (!fs.existsSync(src)) continue;
            const rewritten = rewriteJsEntryRelativeImports(fs.readFileSync(src, 'utf8'), {});
            ingestCandidate(abs, rel, rewrites, objects, {
                transform: () => Buffer.from(rewritten, 'utf8'),
            });
            continue;
        }
        ingestCandidate(abs, rel, rewrites, objects, { transform: null });
    }

    // Aggregator CSS (vmz.css) must import hashed leaf files — rewrite then hash.
    for (const rel of ordered) {
        if (!CSS_AGGREGATORS.has(rel)) continue;
        const src = path.join(abs, rel);
        if (!fs.existsSync(src)) continue;
        const rewritten = rewriteCssImports(fs.readFileSync(src, 'utf8'), rewrites);
        removeLogicalObject(objects, rel);
        delete rewrites[`/${rel}`];
        delete rewrites[rel];
        ingestCandidate(abs, rel, rewrites, objects, {
            transform: () => Buffer.from(rewritten, 'utf8'),
        });
    }

    // JS entry shells: rewrite relative ESM (static + dynamic) then re-hash.
    for (const rel of ordered) {
        if (!JS_ENTRY_AGGREGATORS.has(rel)) continue;
        const src = path.join(abs, rel);
        if (!fs.existsSync(src)) continue;
        const rewritten = rewriteJsEntryRelativeImports(fs.readFileSync(src, 'utf8'), rewrites);
        removeLogicalObject(objects, rel);
        delete rewrites[`/${rel}`];
        delete rewrites[rel];
        ingestCandidate(abs, rel, rewrites, objects, {
            transform: () => Buffer.from(rewritten, 'utf8'),
        });
    }

    objects.sort((a, b) => (a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0));

    const manifest: ContentAddressedAssetsManifest = {
        schema: CONTENT_ADDRESSED_ASSETS_SCHEMA,
        layout: 'assets/<sha256>.<ext>',
        immutable: true,
        objectCount: objects.length,
        objects,
        rewrittenHtml: 0,
    };
    manifest.manifestDigest = sha256Hex(canonicalJson({ ...manifest, manifestDigest: undefined }));

    const vmzDir = path.join(abs, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    const outPath = path.join(vmzDir, 'content-addressed-assets.json');
    writePrettyJsonFile(outPath, manifest);

    return { manifest, assetsDir, rewrites, manifestPath: outPath };
}

/**
 * @param {string[]} candidates
 */
function orderCandidates(candidates: string[]) {
    const set = new Set(candidates.map((c) => String(c).replace(/\\/g, '/').replace(/^\//, '')));
    const out: string[] = [];
    for (const name of DEFAULT_CANDIDATES) {
        if (set.has(name) && !CSS_AGGREGATORS.has(name) && !JS_ENTRY_AGGREGATORS.has(name)) out.push(name);
    }
    for (const name of [...set].sort()) {
        if (!CSS_AGGREGATORS.has(name) && !JS_ENTRY_AGGREGATORS.has(name) && !out.includes(name)) {
            out.push(name);
        }
    }
    if (set.has('vmz.css')) out.push('vmz.css');
    for (const name of ['entry-client.js', 'entry-event.js']) {
        if (set.has(name)) out.push(name);
    }
    return out;
}

/**
 * @param {Array<Record<string, any>>} objects
 * @param {string} logical
 */
function removeLogicalObject(objects: ContentAddressedAssetObject[], logical: string) {
    const idx = objects.findIndex((o) => o.logicalPath === logical);
    if (idx >= 0) objects.splice(idx, 1);
}

/**
 * @param {string} absDist
 * @param {string} rel
 * @param {Record<string, string>} rewrites
 * @param {Array<Record<string, any>>} objects
 * @param {{ transform?: ((buf: Buffer) => Buffer) | null }} opts
 */
function ingestCandidate(
    absDist: string,
    rel: string,
    rewrites: Record<string, string>,
    objects: ContentAddressedAssetObject[],
    opts: IngestCandidateOpts,
) {
    const logical = String(rel).replace(/\\/g, '/').replace(/^\//, '');
    const src = path.join(absDist, ...logical.split('/'));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    let buf: Buffer = Buffer.from(fs.readFileSync(src));
    if (typeof opts.transform === 'function') {
        buf = Buffer.from(opts.transform(buf));
    }
    const digest = sha256Hex(buf);
    const ext = path.extname(logical) || '';
    const assetRel = `assets/${digest}${ext}`;
    const dest = path.join(absDist, ...assetRel.split('/'));
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
    } else {
        const existing = sha256Hex(fs.readFileSync(dest));
        if (existing !== digest) {
            // Stale assets/ from a prior partial build can reuse hash filenames with different bytes.
            fs.writeFileSync(dest, buf);
        }
    }
    objects.push({
        logicalPath: logical,
        assetPath: assetRel,
        digest,
        bytes: buf.length,
        immutable: true,
    });
    rewrites[`/${logical}`] = `/${assetRel}`;
    rewrites[logical] = assetRel;
}

/**
 * Resolve an immutable object by digest under dist/assets (cross-source reuse).
 * @param {string} distDir
 * @param {string} digest
 * @param {string} [ext]
 */
export function resolveAssetByDigest(distDir, digest, ext = '') {
    const d = String(digest || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(d)) return null;
    const suffix = ext && !ext.startsWith('.') ? `.${ext}` : ext;
    const rel = `assets/${d}${suffix}`;
    const abs = path.join(distDir, ...rel.split('/'));
    if (!fs.existsSync(abs)) return null;
    return { assetPath: rel, digest: d.toLowerCase(), bytes: fs.statSync(abs).size };
}

/**
 * Prove two buffers share one asset path (content-address stability).
 * @param {string} distDir
 * @param {Buffer|string} a
 * @param {Buffer|string} b
 * @param {string} [ext]
 */
export function assertSharedAssetPath(distDir, a, b, ext = '.js') {
    const da = sha256Hex(a);
    const db = sha256Hex(b);
    if (da !== db) {
        return { ok: false, reason: 'digests differ', digestA: da, digestB: db };
    }
    const assetsDir = path.join(distDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const rel = `assets/${da}${ext}`;
    const dest = path.join(distDir, ...rel.split('/'));
    fs.writeFileSync(dest, typeof a === 'string' ? Buffer.from(a) : a);
    fs.writeFileSync(dest, typeof b === 'string' ? Buffer.from(b) : b);
    const again = resolveAssetByDigest(distDir, da, ext);
    if (!again || again.assetPath !== rel) {
        return { ok: false, reason: 'resolve missed shared path', rel };
    }
    return { ok: true, assetPath: rel, digest: da };
}

function collectCandidates(distDir: string) {
    const out: string[] = [];
    for (const name of DEFAULT_CANDIDATES) {
        if (fs.existsSync(path.join(distDir, name))) out.push(name);
    }
    walk(distDir, distDir, (rel) => {
        if (/\.client\.js$/i.test(rel)) out.push(rel);
    });
    return [...new Set(out)].sort();
}

function walk(root: string, dir: string, onFile: (rel: string) => void) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'assets' || name === '_vmz' || name === 'node_modules') continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(root, full, onFile);
        else onFile(path.relative(root, full).replace(/\\/g, '/'));
    }
}

/** Resolve `/logical` → hashed href from emit rewrites (`/assets/<sha>.ext`). */
export function hashedAssetHref(rewrites: Record<string, string>, logical: string | null | undefined): string | null {
    if (!logical) return null;
    const raw = String(logical).replace(/\\/g, '/');
    const key = raw.startsWith('/') ? raw : `/${raw.replace(/^\.\//, '')}`;
    const hit = rewrites[key] || rewrites[key.slice(1)];
    if (!hit) return key.startsWith('/') ? key : `/${key}`;
    return hit.startsWith('/') ? hit : `/${hit}`;
}

export function contentAddressedAssetsDigest(manifest) {
    return manifest.manifestDigest || sha256Hex(canonicalJson({ ...manifest, manifestDigest: undefined }));
}

export function sha256Buffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * A3: content-addressed assets/<hash> layout for immutable CDN objects.
 * Logical paths stay available for serve/dev; static HTML rewrites to hashed URLs.
 * CSS aggregators (vmz.css) rewrite `@import` to hashed sibling paths under assets/.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './release-pack.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const CONTENT_ADDRESSED_ASSETS_SCHEMA = 'vmz.content_addressed_assets.v0';

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
 * Emit `assets/<sha256>.<ext>` copies and rewrite HTML href/src to hashed URLs.
 * @param {string} distDir
 * @param {{ candidates?: string[], rewriteHtml?: boolean }} [opts]
 */
export function emitContentAddressedAssets(distDir, opts = {}) {
    const abs = path.resolve(distDir);
    if (!fs.existsSync(abs)) {
        throw new Error(`emitContentAddressedAssets: missing dist ${abs}`);
    }
    const assetsDir = path.join(abs, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const candidates = Array.isArray(opts.candidates) ? opts.candidates : collectCandidates(abs);
    /** @type {Array<Record<string, any>>} */
    const objects = [];
    /** @type {Record<string, string>} */
    const rewrites = {};

    const ordered = orderCandidates(candidates);
    for (const rel of ordered) {
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

    objects.sort((a, b) => (a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0));

    let rewrittenHtml = 0;
    if (opts.rewriteHtml !== false) {
        rewrittenHtml = rewriteHtmlReferences(abs, rewrites);
    }

    const manifest = {
        schema: CONTENT_ADDRESSED_ASSETS_SCHEMA,
        layout: 'assets/<sha256>.<ext>',
        immutable: true,
        objectCount: objects.length,
        objects,
        rewrittenHtml,
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
function orderCandidates(candidates) {
    const set = new Set(candidates.map((c) => String(c).replace(/\\/g, '/').replace(/^\//, '')));
    /** @type {string[]} */
    const out = [];
    for (const name of DEFAULT_CANDIDATES) {
        if (set.has(name) && !CSS_AGGREGATORS.has(name)) out.push(name);
    }
    for (const name of [...set].sort()) {
        if (!CSS_AGGREGATORS.has(name) && !out.includes(name)) out.push(name);
    }
    if (set.has('vmz.css')) out.push('vmz.css');
    return out;
}

/**
 * @param {Array<Record<string, any>>} objects
 * @param {string} logical
 */
function removeLogicalObject(objects, logical) {
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
function ingestCandidate(absDist, rel, rewrites, objects, opts) {
    const logical = String(rel).replace(/\\/g, '/').replace(/^\//, '');
    const src = path.join(absDist, ...logical.split('/'));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    let buf = fs.readFileSync(src);
    if (typeof opts.transform === 'function') {
        buf = opts.transform(buf);
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
            throw new Error(`content-address collision at ${assetRel}`);
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

function collectCandidates(distDir) {
    /** @type {string[]} */
    const out = [];
    for (const name of DEFAULT_CANDIDATES) {
        if (fs.existsSync(path.join(distDir, name))) out.push(name);
    }
    walk(distDir, distDir, (rel) => {
        if (/\.client\.js$/i.test(rel)) out.push(rel);
    });
    return [...new Set(out)].sort();
}

function walk(root, dir, onFile) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'assets' || name === '_vmz' || name === 'node_modules') continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(root, full, onFile);
        else onFile(path.relative(root, full).replace(/\\/g, '/'));
    }
}

/**
 * @param {string} distDir
 * @param {Record<string, string>} rewrites map `/logical` → `/assets/hash.ext`
 */
function rewriteHtmlReferences(distDir, rewrites) {
    const pairs = Object.entries(rewrites)
        .filter(([from]) => from.startsWith('/'))
        .sort((a, b) => b[0].length - a[0].length);
    if (!pairs.length) return 0;
    let count = 0;
    walkHtml(distDir, (file) => {
        let text = fs.readFileSync(file, 'utf8');
        let next = text;
        for (const [from, to] of pairs) {
            next = next.split(from).join(to);
        }
        if (next !== text) {
            fs.writeFileSync(file, next, 'utf8');
            count += 1;
        }
    });
    return count;
}

function walkHtml(dir, onFile) {
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        for (const name of fs.readdirSync(cur)) {
            if (name === 'assets' || name === '_vmz' || name === 'node_modules') continue;
            const full = path.join(cur, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) stack.push(full);
            else if (name.endsWith('.html')) onFile(full);
        }
    }
}

export function contentAddressedAssetsDigest(manifest) {
    return manifest.manifestDigest || sha256Hex(canonicalJson({ ...manifest, manifestDigest: undefined }));
}

export function sha256Buffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

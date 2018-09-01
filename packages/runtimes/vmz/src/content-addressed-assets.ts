/**
 * A3: content-addressed assets/<hash> layout for immutable CDN objects.
 * Logical paths stay available for serve/dev; static HTML rewrites to hashed URLs.
 * Identical bytes → identical asset path (cross-release / cross-source reuse by digest).
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
    'vmz-dom.js',
    'vmz-runtime.js',
    'vmz-http.js',
    'vmz-client-nav.js',
];

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

    for (const rel of candidates) {
        const logical = String(rel).replace(/\\/g, '/').replace(/^\//, '');
        const src = path.join(abs, ...logical.split('/'));
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
        const buf = fs.readFileSync(src);
        const digest = sha256Hex(buf);
        const ext = path.extname(logical) || '';
        const assetRel = `assets/${digest}${ext}`;
        const dest = path.join(abs, ...assetRel.split('/'));
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, buf);
        } else {
            // Cross-release reuse: identical digest must not be rewritten.
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
    // Second write of identical bytes must be reuse, not fork.
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
    // Include top-level *.client.js and pages/**/*.client.js referenced by resume.
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
            // href="/x" src="/x" and unquoted variants in attributes
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

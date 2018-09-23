/**
 * Opaque site-root static files: project `public/**` → deploy root (static / web-static).
 * Not dependency packaging (no node_modules / @dxo/* scanning).
 */
// @ts-nocheck

import fs from 'node:fs';
import path from 'node:path';
import { writePrettyJsonFile } from './pretty-json.js';

export const PUBLIC_STATIC_ASSETS_SCHEMA = 'vmz.public_static_assets.v0';

/** Relative paths under dist that VMZ owns; public/ must not clobber. */
const RESERVED_EXACT = new Set([
    'entry-client.js',
    'entry-event.js',
    'vmz-dom.js',
    'vmz-runtime.js',
    'vmz-http.js',
    'vmz-client-nav.js',
    'vmz.css',
    'vmz-designs.css',
    'vmz-style.css',
    'vmz-deployment.json',
    'vmz-routes.json',
    'vmz-plugin-targets.json',
    'sitemap.xml',
    'robots.txt',
    '404.html',
]);

/**
 * @param {string} distDir
 * @param {{ projectRoot?: string, publicDir?: string }} [opts]
 */
export function emitPublicStaticAssets(distDir, opts = {}) {
    const absDist = path.resolve(distDir);
    const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
    const publicDir = opts.publicDir
        ? path.resolve(opts.publicDir)
        : projectRoot
          ? path.join(projectRoot, 'public')
          : null;

    if (!publicDir || !fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
        const skipped = {
            schema: PUBLIC_STATIC_ASSETS_SCHEMA,
            status: 'skipped',
            reason: publicDir ? 'public/ missing' : 'no projectRoot',
            fileCount: 0,
            files: [],
            skippedConflicts: [],
        };
        writeArtifact(absDist, skipped);
        return skipped;
    }

    /** @type {Array<{ path: string, bytes: number }>} */
    const files = [];
    /** @type {Array<{ path: string, reason: string }>} */
    const skippedConflicts = [];

    walkFiles(publicDir, (absFile) => {
        const rel = path.relative(publicDir, absFile).replace(/\\/g, '/');
        if (!rel || rel.startsWith('..')) return;
        if (shouldSkipReserved(rel)) {
            skippedConflicts.push({ path: rel, reason: 'reserved-vmz-path' });
            return;
        }
        const dest = path.join(absDist, ...rel.split('/'));
        if (fs.existsSync(dest) && isReservedExisting(rel, dest, absDist)) {
            skippedConflicts.push({ path: rel, reason: 'would-clobber-generated' });
            return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(absFile, dest);
        files.push({ path: rel, bytes: fs.statSync(dest).size });
    });

    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const artifact = {
        schema: PUBLIC_STATIC_ASSETS_SCHEMA,
        status: 'ready',
        source: 'public/',
        fileCount: files.length,
        files,
        skippedConflicts,
    };
    writeArtifact(absDist, artifact);
    return artifact;
}

/**
 * @param {string} rel
 */
function shouldSkipReserved(rel) {
    if (rel === '_vmz' || rel.startsWith('_vmz/')) return true;
    if (RESERVED_EXACT.has(rel)) return true;
    if (rel.startsWith('pages/') || rel.startsWith('components/')) return true;
    if (/\.client\.js$/i.test(rel)) return true;
    if (rel.startsWith('assets/') && /^assets\/[a-f0-9]{64}\./i.test(rel)) return true;
    return false;
}

/**
 * After compile, many generated files already exist; do not let public overwrite them.
 * Allow overwrite of non-reserved paths (e.g. re-copy same wasm).
 * @param {string} rel
 * @param {string} dest
 * @param {string} absDist
 */
function isReservedExisting(rel, dest, absDist) {
    if (shouldSkipReserved(rel)) return true;
    // Never overwrite generated HTML shells that static-emit will (or did) write.
    if (/\.html$/i.test(rel) && fs.existsSync(dest)) {
        const text = fs.readFileSync(dest, 'utf8');
        if (text.includes('data-vmz-page') || text.includes('entry-client')) return true;
    }
    void absDist;
    return false;
}

/**
 * @param {string} dir
 * @param {(absFile: string) => void} onFile
 */
function walkFiles(dir, onFile) {
    for (const name of fs.readdirSync(dir)) {
        if (name === '.' || name === '..') continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walkFiles(full, onFile);
        else if (st.isFile()) onFile(full);
    }
}

/**
 * @param {string} absDist
 * @param {Record<string, unknown>} artifact
 */
function writeArtifact(absDist, artifact) {
    const vmzDir = path.join(absDist, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    writePrettyJsonFile(path.join(vmzDir, 'public-static-assets.json'), artifact);
}

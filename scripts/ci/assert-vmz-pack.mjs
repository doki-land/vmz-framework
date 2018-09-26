/**
 * Assert `@vmz/vmz` staged/built dist matches the tagged source contract.
 * Prevents OIDC publish of stale/incomplete runtime artifacts (0.1.13 incident).
 *
 * Usage:
 *   node scripts/ci/assert-vmz-pack.mjs
 *   node scripts/ci/assert-vmz-pack.mjs --dir path/to/stage
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DIST = path.join(ROOT, 'packages/runtimes/vmz/dist');
const SRC = path.join(ROOT, 'packages/runtimes/vmz/src');

function fail(msg) {
    console.error(`assert-vmz-pack: ${msg}`);
    process.exit(1);
}

function parseDir() {
    const arg = process.argv.find((a) => a.startsWith('--dir='));
    if (arg) return path.resolve(arg.slice('--dir='.length));
    const i = process.argv.indexOf('--dir');
    if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
    return DEFAULT_DIST;
}

const dist = parseDir();
if (!fs.existsSync(dist)) fail(`missing dist dir: ${dist}`);

/** @type {string[]} */
const required = [
    'index.js',
    'static-emit.js',
    'content-addressed-assets.js',
    'public-static-assets.js',
    'site-favicon.js',
    'pretty-json.js',
    'delivery-profile.js',
    'build-assemble.js',
];

for (const rel of required) {
    const p = path.join(dist, rel);
    if (!fs.existsSync(p)) fail(`missing required file ${rel} under ${dist}`);
}

// Source modules that must exist and compile into dist (catch incomplete checkout / stale tree).
for (const srcRel of [
    'content-addressed-assets.ts',
    'public-static-assets.ts',
    'site-favicon.ts',
    'pretty-json.ts',
    'delivery-profile.ts',
]) {
    if (!fs.existsSync(path.join(SRC, srcRel))) {
        fail(`missing source ${srcRel} — cannot claim a complete @vmz/vmz pack`);
    }
}

const ca = fs.readFileSync(path.join(dist, 'content-addressed-assets.js'), 'utf8');
if (!ca.includes('rewriteJsEntryRelativeImports')) {
    fail('content-addressed-assets.js missing export rewriteJsEntryRelativeImports (stale dist)');
}
if (!ca.includes('JS_ENTRY_AGGREGATORS') && !ca.includes('entry-client')) {
    fail('content-addressed-assets.js looks incomplete for entry ESM rewrite');
}

const se = fs.readFileSync(path.join(dist, 'static-emit.js'), 'utf8');
for (const needle of ['public-static-assets', 'site-favicon', 'content-addressed-assets']) {
    if (!se.includes(needle)) {
        fail(`static-emit.js missing import/use of ${needle} (stale/incomplete dist)`);
    }
}

const dp = fs.readFileSync(path.join(dist, 'delivery-profile.js'), 'utf8');
if (!dp.includes('web-static')) {
    fail('delivery-profile.js missing web-static assembly (stale dist)');
}
if (!dp.includes('resolveProfileArtifactDir') && !dp.includes('nameExplicit')) {
    fail('delivery-profile.js missing profile name / artifact dir helpers (stale dist)');
}

// Smoke: load content-addressed rewrite helper from built file.
const modUrl = pathToFileURL(path.join(dist, 'content-addressed-assets.js')).href;
const mod = await import(modUrl);
if (typeof mod.rewriteJsEntryRelativeImports !== 'function') {
    fail('rewriteJsEntryRelativeImports is not an exported function');
}
const sample = mod.rewriteJsEntryRelativeImports('import x from "./vmz-dom.js";', {});
if (typeof sample !== 'string') fail('rewriteJsEntryRelativeImports must return string');
if (!sample.includes('../vmz-dom.js')) {
    fail('rewriteJsEntryRelativeImports must rewrite ./vmz-dom.js → ../vmz-dom.js');
}
// Bug B guard: never prefer hashed sibling (barrel second-hop would 404 under /assets/).
const withSibling = mod.rewriteJsEntryRelativeImports('import x from "./vmz-dom.js";', {
    'vmz-dom.js': 'assets/deadbeef.js',
    '/vmz-dom.js': '/assets/deadbeef.js',
});
if (!withSibling.includes('../vmz-dom.js') || withSibling.includes('./deadbeef.js')) {
    fail('rewriteJsEntryRelativeImports must prefer ../ over hashed sibling (Bug B)');
}
const barrel = mod.rewriteJsEntryRelativeImports("export * from './dom-core.js';", {});
if (!barrel.includes('../dom-core.js')) {
    fail('rewriteJsEntryRelativeImports must rewrite barrel export * from ./ → ../');
}

const indexPath = path.join(dist, 'index.js');
if (fs.existsSync(indexPath)) {
    const idx = fs.readFileSync(indexPath, 'utf8');
    if (!idx.includes('rewriteJsEntryRelativeImports')) {
        fail('index.js does not re-export rewriteJsEntryRelativeImports');
    }
    if (!idx.includes('resolveProfileArtifactDir')) {
        fail('index.js does not re-export resolveProfileArtifactDir');
    }
}

console.log(`assert-vmz-pack: OK (${path.relative(ROOT, dist) || dist})`);

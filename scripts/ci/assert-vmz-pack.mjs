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

/** Publish job stages matrix natives under VMZ_NATIVE_ARTIFACTS — wire before oxc smoke. */
function bootstrapNativeForSmoke() {
    if (process.env.VMZ_NATIVE_NODE?.trim()) return;
    const artifactsRoot = process.env.VMZ_NATIVE_ARTIFACTS || path.join(ROOT, 'dist', 'native-flat');
    const { platform, arch } = process;
    let short = `${platform}-${arch}`;
    let triple = short;
    if (platform === 'linux' && arch === 'x64') {
        short = 'linux-x64';
        triple = 'linux-x64-gnu';
    } else if (platform === 'linux' && arch === 'arm64') {
        short = 'linux-arm64';
        triple = 'linux-arm64-gnu';
    } else if (platform === 'darwin' && arch === 'arm64') {
        short = 'darwin-arm64';
        triple = 'darwin-arm64';
    } else if (platform === 'darwin' && arch === 'x64') {
        short = 'darwin-x64';
        triple = 'darwin-x64';
    } else if (platform === 'win32' && arch === 'x64') {
        short = 'win32-x64';
        triple = 'win32-x64-msvc';
    } else if (platform === 'win32' && arch === 'arm64') {
        short = 'win32-arm64';
        triple = 'win32-arm64-msvc';
    }
    const candidates = [
        path.join(artifactsRoot, short, `vmz.${triple}.node`),
        path.join(artifactsRoot, short, 'vmz.node'),
        path.join(ROOT, 'dist', short, `vmz.${triple}.node`),
        path.join(ROOT, `packages/runtimes/vmz-${short}`, `vmz.${triple}.node`),
        path.join(ROOT, `packages/runtimes/vmz-${short}`, 'vmz.node'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            process.env.VMZ_NATIVE_NODE = p;
            return;
        }
    }
}

bootstrapNativeForSmoke();

/** Dist paths relative to `packages/runtimes/vmz/dist` (0.2.0 domain layout). */
const required = [
    'index.js',
    'workspace/static-emit.js',
    'workspace/content-addressed-assets.js',
    'workspace/public-static-assets.js',
    'workspace/site-favicon.js',
    'workspace/pretty-json.js',
    'delivery/delivery-profile.js',
    'workspace/build-assemble.js',
    'cli/cli.js',
];

for (const rel of required) {
    const p = path.join(dist, rel);
    if (!fs.existsSync(p)) fail(`missing required file ${rel} under ${dist}`);
}

for (const srcRel of [
    'workspace/content-addressed-assets.ts',
    'workspace/public-static-assets.ts',
    'workspace/site-favicon.ts',
    'workspace/pretty-json.ts',
    'delivery/delivery-profile.ts',
]) {
    if (!fs.existsSync(path.join(SRC, srcRel))) {
        fail(`missing source ${srcRel} — cannot claim a complete @vmz/vmz pack`);
    }
}

const ca = fs.readFileSync(path.join(dist, 'workspace/content-addressed-assets.js'), 'utf8');
if (!ca.includes('rewriteJsEntryRelativeImports')) {
    fail('content-addressed-assets.js missing export rewriteJsEntryRelativeImports (stale dist)');
}
if (!ca.includes('JS_ENTRY_AGGREGATORS') && !ca.includes('entry-client')) {
    fail('content-addressed-assets.js looks incomplete for entry ESM rewrite');
}

const se = fs.readFileSync(path.join(dist, 'workspace/static-emit.js'), 'utf8');
for (const needle of ['public-static-assets', 'site-favicon', 'content-addressed-assets']) {
    if (!se.includes(needle)) {
        fail(`static-emit.js missing import/use of ${needle} (stale/incomplete dist)`);
    }
}

const dp = fs.readFileSync(path.join(dist, 'delivery/delivery-profile.js'), 'utf8');
if (!dp.includes('web-static')) {
    fail('delivery-profile.js missing web-static assembly (stale dist)');
}
if (!dp.includes('resolveProfileArtifactDir') && !dp.includes('nameExplicit')) {
    fail('delivery-profile.js missing profile name / artifact dir helpers (stale dist)');
}

const modUrl = pathToFileURL(path.join(dist, 'workspace/content-addressed-assets.js')).href;
const mod = await import(modUrl);
if (typeof mod.rewriteJsEntryRelativeImports !== 'function') {
    fail('rewriteJsEntryRelativeImports is not an exported function');
}
const sample = mod.rewriteJsEntryRelativeImports('import x from "./vmz-dom.js";', {});
if (typeof sample !== 'string') fail('rewriteJsEntryRelativeImports must return string');
if (!sample.includes('../vmz-dom.js')) {
    fail('rewriteJsEntryRelativeImports must rewrite ./vmz-dom.js → ../vmz-dom.js');
}
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
    if (!idx.includes('./workspace/public-api.js')) {
        fail('index.js must re-export workspace/public-api.js (thin entry)');
    }
}

const pubApiPath = path.join(dist, 'workspace/public-api.js');
if (fs.existsSync(pubApiPath)) {
    const pub = fs.readFileSync(pubApiPath, 'utf8');
    if (!pub.includes('rewriteJsEntryRelativeImports')) {
        fail('workspace/public-api.js does not re-export rewriteJsEntryRelativeImports');
    }
    if (!pub.includes('resolveProfileArtifactDir')) {
        fail('workspace/public-api.js does not re-export resolveProfileArtifactDir');
    }
}

const localesManifest = path.join(ROOT, 'packages/runtimes/vmz/locales/locales.json');
if (!fs.existsSync(localesManifest)) {
    fail('missing packages/runtimes/vmz/locales/locales.json');
}

console.log(`assert-vmz-pack: OK (${path.relative(ROOT, dist) || dist})`);

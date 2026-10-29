/**
 * Verify the `@vmz/ui-charts` tarball ships only its declared public surface.
 *
 * `@vmz/ui-charts` is the author-facing Vue binding layer over DaVinci: two
 * component entries (`Chart` / `Diagram`) and nothing else. A tarball therefore
 * must contain exactly the declared `exports` targets, resolve against the
 * `@doki-land/davinci` facade only, and stay free of workspace links, private
 * layers, tests and undeclared sources. Both components carry `<style>` blocks,
 * so `sideEffects` has to name them.
 *
 * Usage:
 *   node scripts/ci/verify-ui-charts-pack.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_DIR = path.join(ROOT, 'packages/ui/vmz-ui-charts');
const FACADE_DIR = path.join(ROOT, 'packages/davinci/davinci');
const PRIVATE_PREFIX = '@doki-land/davinci-';
const EXPECTED_EXPORTS = ['./Chart', './Diagram'];
const TEXT_SUFFIXES = ['.json', '.js', '.mjs', '.cjs', '.ts', '.css', '.vmz', '.md'];
const MANIFEST_FILES = ['package.json', 'README.md', 'LICENSE'];

function fail(message) {
    console.error(`verify-ui-charts-pack: ${message}`);
    process.exit(1);
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if ((result.status ?? 1) !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Minimal npm `files` / `sideEffects` pattern matcher (`*` and `**` only). */
function matchesPattern(pattern, relative) {
    const trimmed = pattern.replace(/^\.\//, '');
    let source = '';
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '*') {
            if (trimmed[i + 1] === '*') {
                source += '.*';
                i++;
            } else {
                source += '[^/]*';
            }
        } else {
            source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`).test(relative.replace(/^\.\//, ''));
}

function exportTargets(manifest) {
    return Object.values(manifest.exports ?? {}).flatMap((target) =>
        typeof target === 'string' ? [target] : Object.values(target),
    );
}

/** Tarball entries are `package/<path>` — strip the root segment. */
function listTarball(tarball) {
    const result = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
    if ((result.status ?? 1) !== 0) fail(`cannot list ${path.basename(tarball)}`);
    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((entry) => {
            if (!entry.startsWith('package/') || entry.endsWith('/')) return null;
            return entry.slice('package/'.length);
        })
        .filter(Boolean);
}

const packDir = makeTempDir('ui-charts-pack-');
const extractDir = makeTempDir('ui-charts-extract-');
run('pnpm', ['pack', '--pack-destination', packDir], PACKAGE_DIR);
const tarball = fs.readdirSync(packDir).find((name) => name.endsWith('.tgz'));
if (!tarball) fail(`pnpm pack produced no tarball in ${packDir}`);
const tarballPath = path.join(packDir, tarball);
console.log(`verify-ui-charts-pack: packed ${tarball}`);

run('tar', ['-xzf', tarballPath, '-C', extractDir]);
const packageRoot = path.join(extractDir, 'package');
const entries = listTarball(tarballPath);
if (!entries.includes('package.json')) fail('tarball must ship package.json');

const packedManifest = readJson(path.join(packageRoot, 'package.json'));

// 1. Public exports are the only thing a consumer may resolve.
const exportKeys = Object.keys(packedManifest.exports ?? {}).sort();
if (exportKeys.join('|') !== [...EXPECTED_EXPORTS].sort().join('|')) {
    fail(`public exports drifted: got ${exportKeys.join(', ')}`);
}

const targets = exportTargets(packedManifest).map((target) => target.replace(/^\.\//, ''));
const allowed = new Set([...targets, ...MANIFEST_FILES]);
for (const entry of entries) {
    if (!allowed.has(entry)) fail(`tarball ships an undeclared file: ${entry}`);
}
for (const target of targets) {
    if (entries.includes(target) && fs.existsSync(path.join(packageRoot, target))) continue;
    fail(`export target is missing from the tarball: ${target}`);
}

// `files` has to keep every export target, otherwise a real npm publish drops it.
const files = Array.isArray(packedManifest.files) ? packedManifest.files : [];
for (const target of targets) {
    if (!files.some((pattern) => matchesPattern(pattern, target))) {
        fail(`files does not ship the export target ${target}`);
    }
}

// 2. No workspace link, private layer or workspace-relative path survives the pack.
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const deps = packedManifest[field] ?? {};
    for (const [name, range] of Object.entries(deps)) {
        if (name.startsWith(PRIVATE_PREFIX)) fail(`${field} still depends on the private module ${name}`);
        if (/(workspace|link|file):/.test(String(range))) fail(`${field}.${name} still resolves through "${range}"`);
    }
}
for (const [subpath, target] of Object.entries(packedManifest.exports ?? {})) {
    for (const file of typeof target === 'string' ? [target] : Object.values(target)) {
        const resolved = path.resolve(packageRoot, file);
        if (!resolved.startsWith(packageRoot)) fail(`export ${subpath} escapes the package: ${file}`);
    }
}

const facadeManifest = fs.existsSync(path.join(FACADE_DIR, 'package.json'))
    ? readJson(path.join(FACADE_DIR, 'package.json'))
    : null;
const facadeExports = new Set(Object.keys(facadeManifest?.exports ?? {}));

for (const entry of entries.filter((name) => TEXT_SUFFIXES.some((suffix) => name.endsWith(suffix)))) {
    const text = fs.readFileSync(path.join(packageRoot, entry), 'utf8');
    if (text.includes(PRIVATE_PREFIX)) fail(`${entry} still references a private DaVinci layer`);
    if (/(workspace|link|file):/.test(text)) fail(`${entry} still carries a workspace resolution marker`);
    if (/\.\.\/packages\//.test(text) || /packages\/davinci\//.test(text)) {
        fail(`${entry} references a workspace-relative path`);
    }
    for (const match of text.matchAll(/["'`](@doki-land\/davinci\/[^"'`]+)["'`]/g)) {
        const subpath = `./${match[1].slice('@doki-land/davinci/'.length)}`;
        if (!facadeExports.has(subpath)) fail(`${entry} imports ${match[1]}, which the facade does not export`);
    }
}

// 3. Style-bearing sources must be declared as side effects.
const styleFiles = entries.filter(
    (entry) =>
        entry.endsWith('.css') ||
        (entry.endsWith('.vmz') && /<style[\s>]/.test(fs.readFileSync(path.join(packageRoot, entry), 'utf8'))),
);
const sideEffects = packedManifest.sideEffects;
if (styleFiles.length && sideEffects === undefined) {
    fail(`tarball ships style sources (${styleFiles.join(', ')}) but declares no "sideEffects"`);
}
if (styleFiles.length && sideEffects !== true) {
    if (!Array.isArray(sideEffects)) fail('"sideEffects" must be true or an array of style source paths');
    for (const file of styleFiles) {
        if (!sideEffects.some((pattern) => matchesPattern(pattern, file))) {
            fail(`"sideEffects" does not cover the style source ${file}`);
        }
    }
}

for (const dir of [packDir, extractDir]) fs.rmSync(dir, { recursive: true, force: true });
console.log(`verify-ui-charts-pack: OK (${tarball}, ${EXPECTED_EXPORTS.length} exports)`);

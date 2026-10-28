/**
 * Verify the `@doki-land/davinci` facade tarball is consumable in isolation.
 *
 * The facade is the only published DaVinci engine entry. Every
 * `@doki-land/davinci-*` layer stays `private`, so a tarball must carry no
 * runtime import, type reference or metadata that asks a consumer to resolve
 * them. Consumers also import the facade from outside this workspace, which
 * proves the bundles do not depend on workspace links.
 *
 * Usage:
 *   node scripts/ci/verify-davinci-facade.mjs
 *   node scripts/ci/verify-davinci-facade.mjs --skip-build
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_DIR = path.join(ROOT, 'packages/davinci/davinci');
const PRIVATE_PREFIX = '@doki-land/davinci-';
const EXPECTED_EXPORTS = ['.', './types', './scene', './scene/svg', './chart', './diagram', './runtime', './motion'];
const CONSUMER_SCRIPT = 'consume.mjs';

function fail(message) {
    console.error(`verify-davinci-facade: ${message}`);
    process.exit(1);
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
    if ((result.status ?? 1) !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** `dist` files that a consumer resolves at type or runtime level. */
function distFiles(packageRoot) {
    const dir = path.join(packageRoot, 'dist');
    if (!fs.existsSync(dir)) fail(`missing dist directory in ${packageRoot}`);
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.js') || name.endsWith('.d.ts'))
        .map((name) => path.join(dir, name));
}

const skipBuild = process.argv.includes('--skip-build');
if (!skipBuild) {
    console.log('verify-davinci-facade: building facade');
    run('pnpm', ['--filter', '@doki-land/davinci', 'run', 'build'], ROOT);
}

const packDir = makeTempDir('davinci-facade-pack-');
run('pnpm', ['pack', '--pack-destination', packDir], PACKAGE_DIR);
const tarball = fs.readdirSync(packDir).find((name) => name.endsWith('.tgz'));
if (!tarball) fail(`pnpm pack produced no tarball in ${packDir}`);
const tarballPath = path.join(packDir, tarball);
console.log(`verify-davinci-facade: packed ${tarball}`);

const consumerDir = makeTempDir('davinci-facade-consumer-');
fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'davinci-facade-consumer', private: true, type: 'module' }, null, 4)}\n`,
);
fs.writeFileSync(
    path.join(consumerDir, CONSUMER_SCRIPT),
    `import { fromRows, compile, buildScene } from "@doki-land/davinci/chart";
import { resolve } from "@doki-land/davinci/scene";
import { renderSvg } from "@doki-land/davinci/scene/svg";
import { buildDiagramScene } from "@doki-land/davinci";

const data = fromRows([
    { month: "Jan", sales: 3 },
    { month: "Feb", sales: 5 },
]);
const plan = compile(
    { mark: "bar", encoding: [{ field: "month", channel: "x" }, { field: "sales", channel: "y" }] },
    data,
);
const svg = renderSvg(resolve(buildScene(plan, { width: 240, height: 160 }), { width: 240, height: 160 }));
if (!svg.startsWith("<svg")) throw new Error("renderSvg did not emit an svg root");
if (typeof buildDiagramScene !== "function") throw new Error("facade root does not expose buildDiagramScene");
console.log("verify-davinci-facade: isolated chart render ok");
`,
);

// Install the tarball outside the workspace: a bare `dist/*` import would only
// resolve through workspace links, so a green run here proves self-containment.
run('npm', ['install', '--no-audit', '--no-fund', tarballPath], consumerDir);

const installedDir = path.join(consumerDir, 'node_modules', '@doki-land', 'davinci');
if (!fs.existsSync(installedDir)) fail('tarball did not install as @doki-land/davinci');

const installedManifest = readJson(path.join(installedDir, 'package.json'));

const privateDeps = ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
    Object.keys(installedManifest[field] ?? {}).filter((name) => name.startsWith(PRIVATE_PREFIX)),
);
if (privateDeps.length) fail(`tarball metadata still depends on private modules: ${privateDeps.join(', ')}`);
if (installedManifest.sideEffects !== false) fail('tarball must declare "sideEffects": false');
if (!Array.isArray(installedManifest.files) || !installedManifest.files.includes('dist')) {
    fail('tarball must ship "dist" in "files"');
}
if (Array.isArray(installedManifest.files) && installedManifest.files.includes('src')) {
    fail('tarball must not ship "src"');
}

const exportKeys = Object.keys(installedManifest.exports ?? {}).sort();
const expectedKeys = [...EXPECTED_EXPORTS].sort();
if (exportKeys.join('|') !== expectedKeys.join('|')) {
    fail(`public exports drifted: got ${exportKeys.join(', ')}`);
}

for (const [subpath, target] of Object.entries(installedManifest.exports)) {
    for (const file of Object.values(target)) {
        const resolved = path.resolve(installedDir, file);
        if (!resolved.startsWith(installedDir)) fail(`export ${subpath} escapes the package: ${file}`);
        if (!fs.existsSync(resolved)) fail(`export ${subpath} points at a missing file: ${file}`);
    }
}

for (const file of distFiles(installedDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(PRIVATE_PREFIX)) {
        fail(`${path.relative(installedDir, file)} still references a private module`);
    }
}

run('node', [CONSUMER_SCRIPT], consumerDir);

for (const dir of [packDir, consumerDir]) fs.rmSync(dir, { recursive: true, force: true });
console.log(`verify-davinci-facade: OK (${tarball}, ${EXPECTED_EXPORTS.length} exports)`);

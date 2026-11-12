/**
 * Verify `@vmz/ui-charts` is consumable outside this workspace.
 *
 * The tarball is installed together with `@doki-land/davinci` and `@vmz/core`
 * into a temporary project that has no VMZ compiler and no workspace links.
 * Importing both entries must resolve their bare specifiers from `node_modules`
 * and expose the compiled component classes, and the CSS entries must exist.
 *
 * This is a release gate, not part of the default local test run.
 *
 * Usage:
 *   node scripts/ci/verify-ui-charts-consumer.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UI_CHARTS_DIR = path.join(ROOT, 'packages/ui/vmz-ui-charts');
const FACADE_DIR = path.join(ROOT, 'packages/davinci/davinci');
const CORE_VERSION = '0.3.16';

function fail(message) {
    console.error(`verify-ui-charts-consumer: ${message}`);
    process.exit(1);
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if ((result.status ?? 1) !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function packInto(packageDir, destination) {
    run('pnpm', ['pack', '--pack-destination', destination], packageDir);
    const tarball = fs.readdirSync(destination).find((name) => name.endsWith('.tgz'));
    if (!tarball) fail(`pnpm pack produced no tarball for ${packageDir}`);
    return path.join(destination, tarball);
}

const packDir = makeTempDir('ui-charts-consumer-pack-');
const chartsTarball = packInto(UI_CHARTS_DIR, packDir);
const facadeTarball = packInto(FACADE_DIR, packDir);

const consumerDir = makeTempDir('ui-charts-consumer-');
fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'ui-charts-consumer', private: true, type: 'module' }, null, 4)}\n`,
);

run(
    'npm',
    [
        'install',
        '--no-audit',
        '--no-fund',
        chartsTarball,
        facadeTarball,
        `@vmz/core@${CORE_VERSION}`,
    ],
    consumerDir,
);

const installed = path.join(consumerDir, 'node_modules');
for (const required of ['@vmz/ui-charts', '@doki-land/davinci', '@vmz/core']) {
    if (!fs.existsSync(path.join(installed, required))) {
        fail(`install tree is missing ${required}`);
    }
}
for (const forbidden of ['@vmz/vmz']) {
    if (fs.existsSync(path.join(installed, forbidden))) {
        fail(`consumer install tree must not contain the compiler (${forbidden})`);
    }
}
const privateLayers = fs
    .readdirSync(path.join(installed, '@doki-land'))
    .filter((name) => name !== 'davinci');
if (privateLayers.length) fail(`consumer install tree carries private layers: ${privateLayers.join(', ')}`);

const chartsManifest = JSON.parse(
    fs.readFileSync(path.join(installed, '@vmz/ui-charts', 'package.json'), 'utf8'),
);
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(chartsManifest[field] ?? {})) {
        if (/(workspace|link|file):/.test(String(range))) {
            fail(`${field}.${name} still resolves through "${range}" after install`);
        }
    }
}

fs.writeFileSync(
    path.join(consumerDir, 'consume.mjs'),
    `import Chart from "@vmz/ui-charts/Chart";
import Diagram from "@vmz/ui-charts/Diagram";
import fs from "node:fs";

for (const [name, ctor] of [["Chart", Chart], ["Diagram", Diagram]]) {
    if (typeof ctor !== "function") throw new Error(name + " default export is not a class");
    if (ctor.name !== name) throw new Error(name + " class name drifted: " + ctor.name);
}
for (const name of ["Chart.css", "Diagram.css", "Chart.d.ts", "Diagram.d.ts"]) {
    const file = new URL("./node_modules/@vmz/ui-charts/dist/" + name, import.meta.url);
    if (!fs.existsSync(file)) throw new Error("missing dist/" + name);
}
console.log("verify-ui-charts-consumer: isolated import ok");
`,
);
run('node', ['consume.mjs'], consumerDir);

for (const dir of [packDir, consumerDir]) fs.rmSync(dir, { recursive: true, force: true });
console.log('verify-ui-charts-consumer: OK');

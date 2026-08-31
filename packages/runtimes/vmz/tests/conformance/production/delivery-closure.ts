/**
 * delivery-closure — deployment dependsOn + static manifest + content-addressed assets parity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEPLOYMENT_SCHEMA } from '../../../../vmz-runtime/dist/deployment-registry.js';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;
const runTs = path.join(root, 'packages', 'runtimes', 'vmz', 'tests', 'conformance', 'run.ts');

function fail(msg) {
    console.error(`delivery-closure FAIL: ${msg}`);
    process.exit(1);
}

function runGate(id) {
    const run = spawnSync(
        process.execPath,
        ['--import', resolveHook, '--experimental-strip-types', runTs, id],
        { cwd: root, stdio: 'inherit' },
    );
    if (run.status !== 0) fail(`${id} failed`);
}

console.log('delivery-closure: static-delivery…');
runGate('static-delivery');

console.log('delivery-closure: content-addressed-assets…');
runGate('content-addressed-assets');

console.log('delivery-closure: deployment-artifacts…');
runGate('deployment-artifacts');

console.log('delivery-closure: static profile deployment parity…');
const example = path.join(root, 'packages/examples/production-router');
const dist = path.join(example, 'dist', 'static');
const deploymentPath = path.join(dist, 'vmz-deployment.json');
if (!fs.existsSync(deploymentPath)) fail(`missing ${deploymentPath} after static gates`);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
if (deployment.schema !== DEPLOYMENT_SCHEMA) fail(`bad deployment schema ${deployment.schema}`);
const index = (deployment.units || []).find((u) => u.chunkId === 'pages/index');
if (!index?.layoutChain?.length) fail('pages/index missing layoutChain in static deployment');
const layoutRoot = index.layoutChain[0];
const layoutUnit = (deployment.units || []).find((u) => u.chunkId === layoutRoot);
if (!layoutUnit?.clientEntry) fail(`layout unit ${layoutRoot} missing clientEntry`);
const manifestPath = path.join(dist, '_vmz', 'static-delivery-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.contentAddressedAssets?.manifestDigest) {
    fail('StaticDeliveryManifest missing contentAddressedAssets link');
}

console.log('delivery-closure PASS: deployment + static + hashed assets closure');

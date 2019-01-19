/**
 * delivery-closure — deployment dependsOn + StaticEmitPlan/AssetPlan wire + static manifest parity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEPLOYMENT_SCHEMA } from '../../../../vmz-runtime/dist/host/deployment-registry.js';
import { loadNative } from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;
const runTs = path.join(root, 'packages', 'runtimes', 'vmz', 'tests', 'conformance', 'run.ts');

function fail(msg: string): never {
    console.error(`delivery-closure FAIL: ${msg}`);
    process.exit(1);
}

function runGate(id: string) {
    const run = spawnSync(process.execPath, ['--import', resolveHook, '--experimental-strip-types', runTs, id], {
        cwd: root,
        stdio: 'inherit',
    });
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

const native = loadNative();
for (const fn of ['staticEmitPlanValidate', 'assetPlanValidate', 'contentAddressedAssetsValidate', 'staticDeliveryManifestValidate'] as const) {
    if (typeof native[fn] !== 'function') {
        fail(`native missing ${fn} — run pnpm napi:build`);
    }
}

const deploymentText = fs.readFileSync(deploymentPath, 'utf8');
const deployment = JSON.parse(deploymentText);
if (deployment.schema !== DEPLOYMENT_SCHEMA) fail(`bad deployment schema ${deployment.schema}`);

const index = (deployment.units || []).find((u: { chunkId?: string }) => u.chunkId === 'pages/index');
if (!index?.layoutChain?.length) fail('pages/index missing layoutChain in static deployment');
const layoutRoot = index.layoutChain[0];
const layoutUnit = (deployment.units || []).find((u: { chunkId?: string }) => u.chunkId === layoutRoot);
if (!layoutUnit?.clientEntry) fail(`layout unit ${layoutRoot} missing clientEntry`);

for (const layoutId of index.layoutChain as string[]) {
    if (!(index.dependsOn || []).includes(layoutId)) {
        fail(`pages/index dependsOn missing layout ${layoutId}`);
    }
}

const closure = [...native.deploymentDependsOnClosure(deploymentText, ['pages/index'])].sort();
for (const layoutId of index.layoutChain as string[]) {
    if (!closure.includes(layoutId)) {
        fail(`dependsOn closure missing layout ${layoutId}`);
    }
}
if (!closure.includes('pages/index')) fail('dependsOn closure missing pages/index');

const vmzDir = path.join(dist, '_vmz');
const planPath = path.join(vmzDir, 'static-emit-plan.json');
const assetPlanPath = path.join(vmzDir, 'asset-plan.json');
const contentPath = path.join(vmzDir, 'content-addressed-assets.json');
const manifestPath = path.join(vmzDir, 'static-delivery-manifest.json');

for (const [label, p, validate] of [
    ['static-emit-plan', planPath, 'staticEmitPlanValidate'],
    ['asset-plan', assetPlanPath, 'assetPlanValidate'],
    ['content-addressed-assets', contentPath, 'contentAddressedAssetsValidate'],
    ['static-delivery-manifest', manifestPath, 'staticDeliveryManifestValidate'],
] as const) {
    if (!fs.existsSync(p)) fail(`missing ${label} at ${p}`);
    native[validate](fs.readFileSync(p, 'utf8'));
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
if (manifest.contentAddressedAssets?.manifestDigest !== content.manifestDigest) {
    fail('StaticDeliveryManifest contentAddressedAssets digest mismatch');
}

console.log('delivery-closure PASS: deployment dependsOn + plan wire + static + hashed assets closure');

/**
 * deployment-artifacts — Rust vmz-artifacts N-API + @vmz/core host wiring (Phase 2).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    collectDependsOnClosure,
    componentEntriesFromDeployment,
    DEPLOYMENT_SCHEMA,
} from '../../../../vmz-runtime/dist/deployment-registry.js';
import { loadNative } from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`DEPLOYMENT-ARTIFACTS GATE FAIL: ${msg}`);
    process.exit(1);
}

const root = repoRoot(import.meta.url);

const FIXTURE = `{
  "schema": "${DEPLOYMENT_SCHEMA}",
  "units": [
    {
      "chunkId": "pages/index",
      "kind": "page",
      "dependsOn": ["components/Button", "layouts/App"]
    },
    {
      "chunkId": "components/Button",
      "kind": "component",
      "clientEntry": "components/Button.client.js",
      "source": "src/components/Button.vmz",
      "dependsOn": ["components/Icon"]
    },
    {
      "chunkId": "components/Icon",
      "kind": "component",
      "clientEntry": "components/Icon.client.js",
      "source": "src/components/Icon.vmz"
    },
    {
      "chunkId": "layouts/App",
      "kind": "component",
      "clientEntry": "layouts/App.client.js",
      "source": "src/layouts/App.vmz"
    }
  ]
}`;

const EXPECTED_CLOSURE = ['components/Button', 'components/Icon', 'layouts/App', 'pages/index'].sort();

const EXPECTED_COMPONENT_ENTRIES = [
    {
        chunkId: 'components/Button',
        name: 'Button',
        entry: 'components/Button.client.js',
        source: 'src/components/Button.vmz',
    },
    {
        chunkId: 'components/Icon',
        name: 'Icon',
        entry: 'components/Icon.client.js',
        source: 'src/components/Icon.vmz',
    },
    {
        chunkId: 'layouts/App',
        name: 'App',
        entry: 'layouts/App.client.js',
        source: 'src/layouts/App.vmz',
    },
];

console.log('deployment-artifacts: native addon…');
const native = loadNative();

if (typeof native.deploymentValidate !== 'function') {
    fail('native missing deploymentValidate — run pnpm napi:build');
}

native.deploymentValidate(FIXTURE);

const doc = JSON.parse(FIXTURE);

const nativeClosure = [...native.deploymentDependsOnClosure(FIXTURE, ['pages/index'])].sort();
if (JSON.stringify(nativeClosure) !== JSON.stringify(EXPECTED_CLOSURE)) {
    fail(`native closure mismatch expected=${JSON.stringify(EXPECTED_CLOSURE)} got=${JSON.stringify(nativeClosure)}`);
}

const nativeEntries = native.deploymentComponentEntries(FIXTURE);
if (JSON.stringify(nativeEntries) !== JSON.stringify(EXPECTED_COMPONENT_ENTRIES)) {
    fail(`native component entries mismatch expected=${JSON.stringify(EXPECTED_COMPONENT_ENTRIES)} got=${JSON.stringify(nativeEntries)}`);
}

console.log('deployment-artifacts: @vmz/core host (N-API-backed)…');
const hostClosure = [...collectDependsOnClosure(doc, ['pages/index'])].sort();
if (JSON.stringify(hostClosure) !== JSON.stringify(EXPECTED_CLOSURE)) {
    fail(`host closure mismatch expected=${JSON.stringify(EXPECTED_CLOSURE)} got=${JSON.stringify(hostClosure)}`);
}

const hostEntries = componentEntriesFromDeployment(doc);
if (JSON.stringify(hostEntries) !== JSON.stringify(EXPECTED_COMPONENT_ENTRIES)) {
    fail(`host component entries mismatch expected=${JSON.stringify(EXPECTED_COMPONENT_ENTRIES)} got=${JSON.stringify(hostEntries)}`);
}

const counterCandidates = [
    path.join(root, 'packages/examples/counter/dist/web-ssr/vmz-deployment.json'),
    path.join(root, 'packages/examples/counter/dist/vmz-deployment.json'),
];
for (const counterDist of counterCandidates) {
    if (!fs.existsSync(counterDist)) continue;
    const live = fs.readFileSync(counterDist, 'utf8');
    try {
        native.deploymentValidate(live);
    } catch (e) {
        console.warn(`deployment-artifacts: skip stale ${path.relative(root, counterDist)} (${e instanceof Error ? e.message : e})`);
        continue;
    }
    const liveDoc = JSON.parse(live);
    const page = (liveDoc.units || []).find((u: { kind?: string }) => u.kind === 'page');
    if (page?.chunkId) {
        const roots = [String(page.chunkId)];
        const host = [...collectDependsOnClosure(liveDoc, roots)].sort();
        const nat = [...native.deploymentDependsOnClosure(live, roots)].sort();
        if (JSON.stringify(host) !== JSON.stringify(nat)) {
            fail(`live counter closure mismatch for ${page.chunkId}`);
        }
    }
    break;
}

console.log('DEPLOYMENT-ARTIFACTS GATE OK');

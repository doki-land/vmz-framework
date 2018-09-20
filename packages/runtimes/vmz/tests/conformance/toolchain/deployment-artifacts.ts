/**
 * deployment-artifacts — Rust vmz-artifacts vs TS deployment-registry parity (Phase 1).
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

console.log('deployment-artifacts: native addon…');
const native = loadNative();

if (typeof native.deploymentValidate !== 'function') {
    fail('native missing deploymentValidate — run pnpm napi:build');
}

native.deploymentValidate(FIXTURE);

const doc = JSON.parse(FIXTURE);
const tsClosure = [...collectDependsOnClosure(doc, ['pages/index'])].sort();
const nativeClosure = [...native.deploymentDependsOnClosure(FIXTURE, ['pages/index'])].sort();

if (JSON.stringify(tsClosure) !== JSON.stringify(nativeClosure)) {
    fail(`closure mismatch TS=${JSON.stringify(tsClosure)} native=${JSON.stringify(nativeClosure)}`);
}

const tsEntries = componentEntriesFromDeployment(doc);
const nativeEntries = native.deploymentComponentEntries(FIXTURE);
if (tsEntries.length !== nativeEntries.length) {
    fail(`component entry count TS=${tsEntries.length} native=${nativeEntries.length}`);
}
for (let i = 0; i < tsEntries.length; i++) {
    const a = tsEntries[i];
    const b = nativeEntries[i];
    if (a.chunkId !== b.chunkId || a.name !== b.name || a.entry !== b.entry || a.source !== b.source) {
        fail(`component entry[${i}] mismatch TS=${JSON.stringify(a)} native=${JSON.stringify(b)}`);
    }
}

const counterDist = path.join(root, 'packages/examples/counter/dist/vmz-deployment.json');
if (fs.existsSync(counterDist)) {
    const live = fs.readFileSync(counterDist, 'utf8');
    native.deploymentValidate(live);
    const liveDoc = JSON.parse(live);
    const page = (liveDoc.units || []).find((u: { kind?: string }) => u.kind === 'page');
    if (page?.chunkId) {
        const roots = [String(page.chunkId)];
        const ts = [...collectDependsOnClosure(liveDoc, roots)].sort();
        const nat = [...native.deploymentDependsOnClosure(live, roots)].sort();
        if (JSON.stringify(ts) !== JSON.stringify(nat)) {
            fail(`live counter closure mismatch for ${page.chunkId}`);
        }
    }
}

console.log('DEPLOYMENT-ARTIFACTS GATE OK');

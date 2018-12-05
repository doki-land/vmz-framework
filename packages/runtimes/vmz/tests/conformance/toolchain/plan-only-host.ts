/**
 * plan-only-host — hosts refuse filesystem / path re-inference without Plan fields.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitBrowserPathPattern } from '../../../src/route-path.ts';
import { resolveRouteLayoutChain } from '../../../../vmz-runtime/src/route-layout-chain.ts';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`PLAN-ONLY-HOST GATE FAIL: ${msg}`);
    process.exit(1);
}

const root = repoRoot(import.meta.url);

console.log('plan-only-host: no directory-scan fallback symbols…');
const hotPaths = [
    'packages/runtimes/vmz-runtime/src/deployment-registry.ts',
    'packages/runtimes/vmz-runtime/src/list-client-components.ts',
    'packages/runtimes/vmz-runtime/src/route-layout-chain.ts',
    'packages/runtimes/vmz/src/route-path.ts',
    'packages/runtimes/vmz/src/static-emit.ts',
    'packages/runtimes/vmz/src/server-artifact.ts',
];
for (const rel of hotPaths) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (text.includes('listComponentEntriesFromDirectory')) {
        fail(`${rel} still references listComponentEntriesFromDirectory`);
    }
}
const serverArtifact = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/server-artifact.ts'), 'utf8');
if (!serverArtifact.includes('normalizeServerArtifactJson')) {
    fail('server-artifact.ts must call N-API normalizeServerArtifactJson (thin host)');
}
if (serverArtifact.includes('sha256Hex') || serverArtifact.includes('canonicalJson')) {
    fail('server-artifact.ts must not assemble digests in TS');
}

console.log('plan-only-host: pathPattern / layoutChain required…');
assert.throws(() => unitBrowserPathPattern({ chunkId: 'pages/index' }), /missing pathPattern/);
assert.throws(() => unitBrowserPathPattern({ chunkId: 'pages/index', pathPattern: '' }), /missing pathPattern/);

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-plan-only-'));
try {
    fs.writeFileSync(
        path.join(dist, 'vmz-deployment.json'),
        JSON.stringify({
            schema: 'vmz.deployment.v0',
            units: [{ chunkId: 'pages/index', kind: 'page', clientEntry: 'pages/index.client.js' }],
        }),
    );
    assert.throws(() => resolveRouteLayoutChain(dist, 'pages/index'), /missing layoutChain/);
} finally {
    fs.rmSync(dist, { recursive: true, force: true });
}

console.log('PLAN-ONLY-HOST GATE OK');
// silence unused import in strip-types path
void fileURLToPath;

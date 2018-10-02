/**
 * deployment-proof: deployment boundary validators / leakage / capability targets / dead graph.
 *
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DX_BOUNDARY_VALIDATOR_SCHEMA,
    DX_CAPABILITY_TARGET_SCHEMA,
    DX_DEAD_GRAPH_SCHEMA,
    DX_LEAKAGE_SCHEMA,
    DX_PROTOCOL,
    DX_DEPLOYMENT_PROOF_CHECK_SCHEMA,
    createWorkspace,
    dxCatalog,
} from 'vmz';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('deployment-proof: DX catalog includes boundary_validator / leakage / capability_target / dead_graph / deployment_proof_check…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['boundary_validator', DX_BOUNDARY_VALIDATOR_SCHEMA],
    ['leakage', DX_LEAKAGE_SCHEMA],
    ['capability_target', DX_CAPABILITY_TARGET_SCHEMA],
    ['dead_graph', DX_DEAD_GRAPH_SCHEMA],
    ['deployment_proof_check', DX_DEPLOYMENT_PROOF_CHECK_SCHEMA],
]) {
    const row = jsDx.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x4-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });

fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Card.vmz'),
    `<template>
  <button @click="increment">{{ n }}</button>
</template>
<script client>
export default class Card {
  n = 0;
  increment() { this.n++; }
  async boot() { return CardServer.load(); }
}
</script>
<script server>
export default class CardServer {
  async load() { return 1; }
}
</script>
`,
);

fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Orphan.vmz'),
    `<template><p>orphan</p></template>
<script client>
export default class Orphan {}
</script>
`,
);

fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <Card />
</template>
<script client>
export default class IndexPage {}
</script>
`,
);

const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });

console.log('deployment-proof: build Card (used) + Orphan (unused)…');
const build = ws.build(false);
if (build?.diagnostics?.length) {
    const errors = build.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'Error');
    if (errors.length) fail(`build errors: ${JSON.stringify(errors).slice(0, 800)}`);
}

for (const name of ['queryBoundaryValidators', 'queryLeakage', 'queryCapabilityTargets', 'queryDeadGraph', 'checkDeploymentProof']) {
    if (typeof ws[name] !== 'function') fail(`${name} missing on Workspace`);
}

console.log('deployment-proof: boundary validators include route pages/index…');
const boundary = JSON.parse(ws.queryBoundaryValidators());
if (boundary.schema !== DX_BOUNDARY_VALIDATOR_SCHEMA) fail(`boundary schema ${boundary.schema}`);
if (!boundary.validators?.some((v) => v.kind === 'route' && (v.id === 'pages/index' || v.chunkId === 'pages/index'))) {
    fail(`missing route pages/index in ${JSON.stringify(boundary.validators).slice(0, 600)}`);
}

console.log('deployment-proof: dead graph includes Orphan, not Card…');
const dead = JSON.parse(ws.queryDeadGraph());
if (dead.schema !== DX_DEAD_GRAPH_SCHEMA) fail(`dead schema ${dead.schema}`);
if (!dead.deadChunks?.includes('components/Orphan')) {
    fail(`deadChunks missing Orphan: ${JSON.stringify(dead.deadChunks)}`);
}
if (dead.deadChunks?.includes('components/Card')) {
    fail(`Card must be reachable, not dead: ${JSON.stringify(dead.deadChunks)}`);
}

console.log('deployment-proof: clean leakage + checkDeploymentProof ready…');
const leak = JSON.parse(ws.queryLeakage());
if (leak.schema !== DX_LEAKAGE_SCHEMA) fail(`leakage schema ${leak.schema}`);
if (leak.status !== 'ready' || (leak.findings || []).length !== 0) {
    fail(`expected clean leakage, got ${JSON.stringify(leak).slice(0, 600)}`);
}
const targets = JSON.parse(ws.queryCapabilityTargets());
if (targets.schema !== DX_CAPABILITY_TARGET_SCHEMA) fail(`targets schema ${targets.schema}`);

const ok = JSON.parse(ws.checkDeploymentProof());
if (ok.schema !== DX_DEPLOYMENT_PROOF_CHECK_SCHEMA) fail(`deployment_proof schema ${ok.schema}`);
if (ok.status !== 'ready') fail(`expected ready, got ${ok.status}: ${JSON.stringify(ok).slice(0, 800)}`);

// Negative leakage (ghostRpc) is proven in Rust unit tests (`deployment_proof::tests::ghost_rpc_fails_leakage`),
// not by mutating real build artifacts in the gate.

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: boundary validators + clean leakage + capability targets + dead graph');

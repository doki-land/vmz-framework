/**
 * X5 gate: runtime trace ↔ Program Graph StableId causal replay.
 *
 * Design: `规划设计/vmz/21` §10 X5.
 *
 * Usage (repo root): pnpm gate:x5
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DX_CAUSAL_REPLAY_SCHEMA, DX_EXPLAIN_SCHEMA, DX_PROTOCOL, DX_TRACE_SCHEMA, DX_X5_CHECK_SCHEMA, createWorkspace, dxCatalog } from 'vmz';

function fail(msg) {
    console.error(`X5 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('X5 gate: DX catalog includes trace / causal_replay / x5_check…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['trace', DX_TRACE_SCHEMA],
    ['causal_replay', DX_CAUSAL_REPLAY_SCHEMA],
    ['x5_check', DX_X5_CHECK_SCHEMA],
]) {
    const row = jsDx.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x5-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });

fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Card.vmz'),
    `<template>
  <p>{n}</p>
  <button @click={increment}>+</button>
</template>
<script client>
export default class Card {
  n = 0;
  increment() { this.n++; }
}
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

for (const name of ['ingestRuntimeTrace', 'replayCausal', 'checkDxX5']) {
    if (typeof ws[name] !== 'function') fail(`${name} missing on Workspace`);
}

console.log('X5 gate: build Card with binding:0 + effect writes…');
const build = ws.build(false);
if (build?.diagnostics?.length) {
    const errors = build.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'Error');
    if (errors.length) fail(`build errors: ${JSON.stringify(errors).slice(0, 800)}`);
}

console.log('X5 gate: explain write:n has effect→field→binding chain…');
const write = JSON.parse(ws.explain('write:n'));
if (write.schema !== DX_EXPLAIN_SCHEMA) fail(`write schema ${write.schema}`);
if (!Array.isArray(write.chain) || write.chain.length < 2) {
    fail(`write chain too short: ${JSON.stringify(write).slice(0, 800)}`);
}
const hasEffect = write.chain.some((e) => e.from?.kind === 'effect' || e.to?.kind === 'effect');
const hasBinding = write.chain.some((e) => e.from?.kind === 'binding' || e.to?.kind === 'binding');
if (!hasEffect || !hasBinding) {
    fail(`write chain missing effect/binding: ${JSON.stringify(write.chain)}`);
}

console.log('X5 gate: explain update:components/Card#binding:0…');
const update = JSON.parse(ws.explain('update:components/Card#binding:0'));
if (update.kind !== 'update' || !(update.chain || []).length) {
    fail(`update explain: ${JSON.stringify(update).slice(0, 800)}`);
}
if (!update.chain.some((e) => e.from?.kind === 'binding' || e.to?.kind === 'binding')) {
    fail(`update chain missing binding StableId`);
}

console.log('X5 gate: synthetic trace ↔ replayCausal ready…');
const synthetic = {
    schema: DX_TRACE_SCHEMA,
    events: [
        {
            kind: 'write',
            stableId: { kind: 'field', id: 'n' },
            dep: 'n',
            chunkId: 'components/Card',
            t: 1,
        },
        {
            kind: 'patch',
            stableId: { kind: 'binding', id: '0' },
            chunkId: 'components/Card',
            t: 2,
        },
    ],
    status: 'ready',
};
const ingested = JSON.parse(ws.ingestRuntimeTrace(JSON.stringify(synthetic)));
if (ingested.schema !== DX_TRACE_SCHEMA || ingested.status !== 'ready') {
    fail(`ingest: ${JSON.stringify(ingested).slice(0, 600)}`);
}
const replay = JSON.parse(ws.replayCausal(JSON.stringify(synthetic)));
if (replay.schema !== DX_CAUSAL_REPLAY_SCHEMA) fail(`replay schema ${replay.schema}`);
if (replay.status !== 'ready') fail(`replay status ${replay.status}: ${JSON.stringify(replay).slice(0, 900)}`);
if (!(replay.matches || []).every((m) => m.inChain)) {
    fail(`not all events inChain: ${JSON.stringify(replay.matches)}`);
}

console.log('X5 gate: checkDxX5 ready…');
const check = JSON.parse(ws.checkDxX5());
if (check.schema !== DX_X5_CHECK_SCHEMA) fail(`x5 schema ${check.schema}`);
if (check.status !== 'ready') fail(`checkDxX5 ${check.status}: ${JSON.stringify(check).slice(0, 900)}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('X5 GATE OK: write/update explain · trace ingest · causal replay · checkDxX5');

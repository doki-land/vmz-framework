/**
 * causal-trace: runtime trace ↔ Program Graph StableId causal replay.
 *
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DX_CAUSAL_REPLAY_SCHEMA,
    DX_EXPLAIN_SCHEMA,
    DX_PROTOCOL,
    DX_TRACE_SCHEMA,
    DX_CAUSAL_REPLAY_CHECK_SCHEMA,
    createWorkspace,
    dxCatalog,
} from 'vmz';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('causal-trace: DX catalog includes trace / causal_replay / causal_replay_check…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['trace', DX_TRACE_SCHEMA],
    ['causal_replay', DX_CAUSAL_REPLAY_SCHEMA],
    ['causal_replay_check', DX_CAUSAL_REPLAY_CHECK_SCHEMA],
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

for (const name of ['ingestRuntimeTrace', 'replayCausal', 'checkCausalReplay']) {
    if (typeof ws[name] !== 'function') fail(`${name} missing on Workspace`);
}

console.log('causal-trace: build Card with binding:0 + effect writes…');
const build = ws.build(false);
if (build?.diagnostics?.length) {
    const errors = build.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'Error');
    if (errors.length) fail(`build errors: ${JSON.stringify(errors).slice(0, 800)}`);
}

console.log('causal-trace: explain write:n has effect→field→binding chain…');
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

console.log('causal-trace: explain update:components/Card#binding:0…');
const update = JSON.parse(ws.explain('update:components/Card#binding:0'));
if (update.kind !== 'update' || !(update.chain || []).length) {
    fail(`update explain: ${JSON.stringify(update).slice(0, 800)}`);
}
if (!update.chain.some((e) => e.from?.kind === 'binding' || e.to?.kind === 'binding')) {
    fail(`update chain missing binding StableId`);
}

console.log('causal-trace: synthetic trace ↔ replayCausal ready…');
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

console.log('causal-trace: checkCausalReplay ready…');
const check = JSON.parse(ws.checkCausalReplay());
if (check.schema !== DX_CAUSAL_REPLAY_CHECK_SCHEMA) fail(`causal_replay schema ${check.schema}`);
if (check.status !== 'ready') fail(`checkCausalReplay ${check.status}: ${JSON.stringify(check).slice(0, 900)}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: write/update explain · trace ingest · causal replay · checkCausalReplay');

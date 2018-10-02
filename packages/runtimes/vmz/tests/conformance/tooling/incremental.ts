/**
 * incremental: semantic transaction · cancel · affected preview · HMR · budget.
 *
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DX_AFFECTED_PREVIEW_SCHEMA,
    DX_BUDGET_SCHEMA,
    DX_CANCEL_SCHEMA,
    DX_HMR_PLAN_SCHEMA,
    DX_PROTOCOL,
    DX_SEMANTIC_TRANSACTION_SCHEMA,
    DX_TRANSACTION_CHECK_SCHEMA,
    createWorkspace,
    dxCatalog,
} from 'vmz';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('incremental: DX catalog includes semantic_transaction / cancel / preview / hmr / budget / transaction_check…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['semantic_transaction', DX_SEMANTIC_TRANSACTION_SCHEMA],
    ['cancel', DX_CANCEL_SCHEMA],
    ['affected_preview', DX_AFFECTED_PREVIEW_SCHEMA],
    ['hmr_plan', DX_HMR_PLAN_SCHEMA],
    ['budget', DX_BUDGET_SCHEMA],
    ['transaction_check', DX_TRANSACTION_CHECK_SCHEMA],
]) {
    const row = jsDx.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x3-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });

const cardPath = path.join(dir, 'src', 'components', 'Card.vmz');
const pagePath = path.join(dir, 'src', 'pages', 'index.vmz');
fs.writeFileSync(
    cardPath,
    `<template>
  <button @click="increment">{{ n }}</button>
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
    pagePath,
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

for (const name of [
    'applySemanticTransaction',
    'beginAnalysis',
    'cancelAnalysis',
    'queryAffectedPreview',
    'queryHmrPlan',
    'queryBudget',
    'checkTransaction',
]) {
    if (typeof ws[name] !== 'function') fail(`${name} missing on Workspace`);
}

console.log('incremental: build → budget ready…');
const build = ws.build(false);
if (build?.diagnostics?.length) {
    const errors = build.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'Error');
    if (errors.length) fail(`build errors: ${JSON.stringify(errors).slice(0, 800)}`);
}

const budget = JSON.parse(ws.queryBudget());
if (budget.schema !== DX_BUDGET_SCHEMA) fail(`budget schema ${budget.schema}`);
if (budget.status !== 'ready' || !(budget.chunks || []).length) {
    fail(`expected ready budget with chunks, got ${JSON.stringify(budget).slice(0, 600)}`);
}

console.log('incremental: dirty page → affected preview + HMR…');
ws.updateFiles([{ path: pagePath, kind: 'update' }]);
const preview = JSON.parse(ws.queryAffectedPreview());
if (preview.schema !== DX_AFFECTED_PREVIEW_SCHEMA) fail(`preview schema ${preview.schema}`);
if (!preview.affected || !preview.testSelection || typeof preview.testSelection !== 'object') {
    fail(`preview missing affected/testSelection: ${JSON.stringify(preview).slice(0, 600)}`);
}
const hmr = JSON.parse(ws.queryHmrPlan());
if (hmr.schema !== DX_HMR_PLAN_SCHEMA) fail(`hmr schema ${hmr.schema}`);
if (!['island', 'partial', 'full'].includes(hmr.mode)) {
    fail(`hmr.mode invalid: ${hmr.mode}`);
}

const check = JSON.parse(ws.checkTransaction());
if (check.schema !== DX_TRANSACTION_CHECK_SCHEMA) fail(`transaction schema ${check.schema}`);
if (!['ready', 'preview'].includes(check.status)) {
    fail(`checkTransaction status ${check.status}`);
}

console.log('incremental: semantic transaction commit + reject…');
const aRel = 'src/components/Card.vmz';
const bRel = 'src/pages/index.vmz';
const aBefore = fs.readFileSync(path.join(dir, aRel), 'utf8');
const bBefore = fs.readFileSync(path.join(dir, bRel), 'utf8');
const committed = JSON.parse(
    ws.applySemanticTransaction(
        JSON.stringify([
            { path: aRel, start: 0, end: 4, newText: 'XXXX' },
            { path: bRel, start: 0, end: 4, newText: 'YYYY' },
        ]),
    ),
);
if (committed.schema !== DX_SEMANTIC_TRANSACTION_SCHEMA) fail(`tx schema ${committed.schema}`);
if (committed.status !== 'committed') fail(`expected committed, got ${JSON.stringify(committed).slice(0, 600)}`);
if (!fs.readFileSync(path.join(dir, aRel), 'utf8').startsWith('XXXX')) fail('Card.vmz not updated');
if (!fs.readFileSync(path.join(dir, bRel), 'utf8').startsWith('YYYY')) fail('index.vmz not updated');

fs.writeFileSync(path.join(dir, aRel), aBefore);
fs.writeFileSync(path.join(dir, bRel), bBefore);
const rejected = JSON.parse(ws.applySemanticTransaction(JSON.stringify([{ path: aRel, start: 0, end: 99999, newText: 'nope' }])));
if (rejected.status !== 'rejected') fail(`expected rejected, got ${rejected.status}`);
if (fs.readFileSync(path.join(dir, aRel), 'utf8') !== aBefore) {
    fail('rejected transaction must not write');
}

console.log('incremental: cancel ticket rejects build…');
const ticketDoc = JSON.parse(ws.beginAnalysis());
if (ticketDoc.schema !== DX_CANCEL_SCHEMA || ticketDoc.status !== 'running') {
    fail(`beginAnalysis: ${JSON.stringify(ticketDoc)}`);
}
const cancelled = JSON.parse(ws.cancelAnalysis(ticketDoc.ticketId));
if (cancelled.status !== 'cancelled') fail(`cancel status ${cancelled.status}`);
let rejectedBuild = false;
try {
    ws.build(false, ticketDoc.ticketId);
} catch (e) {
    rejectedBuild = /cancel/i.test(String(e?.message || e));
}
if (!rejectedBuild) fail('build with cancelled ticket must throw');

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: transaction · cancel · preview · HMR · budget · checkTransaction');

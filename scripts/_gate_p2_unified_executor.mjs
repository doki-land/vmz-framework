/**
 * P2 gate: Unified Executor — same transaction across Surfaces,
 * generation discard, DisposeRegion / cancel (doc 13 §4.7 / §4.14).
 *
 * Algebraic first version — no real DOM/iOS/Android adapters.
 *
 * Usage (repo root): pnpm gate:p2
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_EXECUTOR_CHECK_SCHEMA,
    PROFILE_EXECUTOR_SCENARIO_SCHEMA,
    PROFILE_PROTOCOL,
    checkP2UnifiedExecutorJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`P2 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('P2 gate: catalog includes executor documents…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'executor_envelope_header',
    'event_envelope',
    'executor_transaction',
    'patch_batch',
    'dispose_region',
    'cancel_request',
    'executor_scenario',
    'executor_check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const code of [
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
]) {
    if (!jsCat.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'executor_check')) {
    fail('native catalog missing executor_check');
}

console.log('P2 gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p2-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <button @click={increment}>{n}</button>
</template>
<script client>
export default class IndexPage {
  n = 0;
  increment() { this.n++; }
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'Application.vmz'),
    `<template><slot /></template>
<script client>
export default class Application {}
</script>
`,
);
const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });
const built = ws.build();
if ((built.diagnostics || []).some((d) => d.severity === 'error')) {
    fail(`build errors: ${JSON.stringify(built.diagnostics)}`);
}

console.log('P2 gate: checkP2UnifiedExecutorJson (mixed camera → T42)…');
const report = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (report.schema !== PROFILE_EXECUTOR_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.scenario?.schema !== PROFILE_EXECUTOR_SCENARIO_SCHEMA) fail('scenario schema');
if (report.scenario.patchBatches?.length !== 3) fail('expected 3 patch batches');
if (report.scenario.transaction?.transactionId !== 'T42') fail('expected T42');
const surfaces = (report.scenario.patchBatches || []).map((b) => b.surfaceId).join(',');
if (!surfaces.includes('web') || !surfaces.includes('native') || !surfaces.includes('headless')) {
    fail(`expected web+native+headless surfaces, got ${surfaces}`);
}
if (JSON.stringify(report).toLowerCase().includes('vdom')) fail('must not mention VDOM');

const wsReport = JSON.parse(ws.checkP2UnifiedExecutor());
if (wsReport.schema !== PROFILE_EXECUTOR_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const base = structuredClone(report.scenario);

console.log('P2 gate: reject missing envelope ids…');
const miss = structuredClone(base);
miss.incomingEvent.header.applicationId = '';
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(miss, null, 2));
const missFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (missFail.status !== 'failed') fail('expected failed for missing ids');
if (!(missFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_MISSING_ENVELOPE_IDS)) {
    fail(`expected ${PROFILE_DIAG_MISSING_ENVELOPE_IDS}`);
}

console.log('P2 gate: reject stale generation…');
const stale = structuredClone(base);
stale.currentGeneration = 99;
stale.mustDiscardStale = true;
stale.producedPatchesFromStale = true;
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(stale, null, 2));
const staleFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (staleFail.status !== 'failed') fail('expected failed for stale');
if (!(staleFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_STALE_GENERATION)) {
    fail(`expected ${PROFILE_DIAG_STALE_GENERATION}`);
}

console.log('P2 gate: reject surface owns state…');
const own = structuredClone(base);
own.stateSlots[0].surfaceDriverOwnsBusinessState = true;
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(own, null, 2));
const ownFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (ownFail.status !== 'failed') fail('expected failed for owns state');
if (!(ownFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_SURFACE_OWNS_STATE)) {
    fail(`expected ${PROFILE_DIAG_SURFACE_OWNS_STATE}`);
}

console.log('P2 gate: reject private object crossing…');
const priv = structuredClone(base);
priv.patchBatches[0].carriesPrivateRuntimeObject = true;
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(priv, null, 2));
const privFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (privFail.status !== 'failed') fail('expected failed for private object');
if (!(privFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_PRIVATE_OBJECT_CROSSING)) {
    fail(`expected ${PROFILE_DIAG_PRIVATE_OBJECT_CROSSING}`);
}

console.log('P2 gate: reject split transaction…');
const split = structuredClone(base);
split.transaction.splitPerSurface = true;
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(split, null, 2));
const splitFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (splitFail.status !== 'failed') fail('expected failed for split');
if (!(splitFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_SPLIT_TRANSACTION)) {
    fail(`expected ${PROFILE_DIAG_SPLIT_TRANSACTION}`);
}

console.log('P2 gate: reject dispose not authoritative…');
const disp = structuredClone(base);
disp.driverUnloadCancelsForeignTasks = true;
disp.disposeRegion = null;
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(disp, null, 2));
const dispFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (dispFail.status !== 'failed') fail('expected failed for dispose');
if (!(dispFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE)) {
    fail(`expected ${PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE}`);
}

console.log('P2 gate: reject cancel not propagated…');
const cancel = structuredClone(base);
cancel.disposeRegion = {
    schema: 'vmz.profile.dispose_region.v0',
    header: cancel.incomingEvent.header,
    cancelsCapabilities: false,
    isAuthoritativeTerminate: true,
};
fs.writeFileSync(path.join(dir, 'executor-scenario.json'), JSON.stringify(cancel, null, 2));
const cancelFail = JSON.parse(checkP2UnifiedExecutorJson(dir));
if (cancelFail.status !== 'failed') fail('expected failed for cancel');
if (!(cancelFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CANCEL_NOT_PROPAGATED)) {
    fail(`expected ${PROFILE_DIAG_CANCEL_NOT_PROPAGATED}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P2 GATE OK: Unified Executor same-tx across Surfaces + generation/cancel/dispose');

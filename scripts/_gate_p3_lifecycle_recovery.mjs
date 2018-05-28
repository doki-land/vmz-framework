/**
 * P3 gate: Lifecycle / Recovery — Browser/Mini/Native map to unified
 * lifecycle; crash recovery reattaches surfaces without duplicating owner
 * (doc 13 §4.8 / §4.14).
 *
 * Algebraic first version — no real DOM/iOS/Android adapters.
 *
 * Usage (repo root): pnpm gate:p3
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
    PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
    PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
    PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
    PROFILE_LIFECYCLE_HOST_KINDS,
    PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA,
    PROFILE_LIFECYCLE_SCENARIO_SCHEMA,
    PROFILE_PERSISTENCE_WINDOWS,
    PROFILE_PROTOCOL,
    PROFILE_UNIFIED_LIFECYCLE_EVENTS,
    checkP3LifecycleRecoveryJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`P3 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('P3 gate: catalog includes lifecycle/recovery documents…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'lifecycle_mapping_entry',
    'lifecycle_mapping_table',
    'recovery_policy',
    'lifecycle_scenario',
    'lifecycle_recovery_check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const code of [
    PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
    PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
    PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
    PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
]) {
    if (!jsCat.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}
for (const ev of PROFILE_UNIFIED_LIFECYCLE_EVENTS) {
    if (!jsCat.unifiedLifecycleEvents.includes(ev)) fail(`missing lifecycle ${ev}`);
}
for (const kind of PROFILE_LIFECYCLE_HOST_KINDS) {
    if (!['browser', 'mini', 'native'].includes(kind)) fail(`bad host kind ${kind}`);
}
for (const w of PROFILE_PERSISTENCE_WINDOWS) {
    if (!['none', 'suspend', 'crash', 'owner'].includes(w)) fail(`bad window ${w}`);
}

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'lifecycle_recovery_check')) {
    fail('native catalog missing lifecycle_recovery_check');
}
if (!(nativeCat.diagnostics || []).includes(PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER)) {
    fail('native catalog missing recovery_duplicates_owner');
}

console.log('P3 gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p3-'));
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

console.log('P3 gate: checkP3LifecycleRecoveryJson (browser+mini+native)…');
const report = JSON.parse(checkP3LifecycleRecoveryJson(dir));
if (report.schema !== PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.scenario?.schema !== PROFILE_LIFECYCLE_SCENARIO_SCHEMA) fail('scenario schema');
if (report.scenario.hosts?.length !== 3) fail('expected 3 hosts');
const kinds = (report.scenario.hosts || [])
    .map((h) => h.hostKind)
    .sort()
    .join(',');
if (kinds !== 'browser,mini,native') fail(`host kinds ${kinds}`);
if (report.scenario.recovery?.createsNewOwnerOnRecover) fail('must not duplicate owner');
if (report.scenario.recovery?.assumesJsHeapSurvived) fail('must not assume JS heap');
if (!(report.scenario.recovery?.surfaceIdsToReattach?.length > 0)) fail('need surfaces to reattach');
if (JSON.stringify(report).toLowerCase().includes('vdom')) fail('must not mention VDOM');

const wsReport = JSON.parse(ws.checkP3LifecycleRecovery());
if (wsReport.schema !== PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const base = structuredClone(report.scenario);

console.log('P3 gate: reject duplicate owner on recover…');
const dup = structuredClone(base);
dup.recovery.createsNewOwnerOnRecover = true;
fs.writeFileSync(path.join(dir, 'lifecycle-scenario.json'), JSON.stringify(dup, null, 2));
const dupFail = JSON.parse(checkP3LifecycleRecoveryJson(dir));
if (dupFail.status !== 'failed') fail('expected failed for duplicate owner');
if (!(dupFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER)) {
    fail(`expected ${PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER}`);
}

console.log('P3 gate: reject assumes JS heap survived…');
const heap = structuredClone(base);
heap.recovery.assumesJsHeapSurvived = true;
fs.writeFileSync(path.join(dir, 'lifecycle-scenario.json'), JSON.stringify(heap, null, 2));
const heapFail = JSON.parse(checkP3LifecycleRecoveryJson(dir));
if (heapFail.status !== 'failed') fail('expected failed for heap');
if (!(heapFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_RECOVERY_ASSUMES_HEAP)) {
    fail(`expected ${PROFILE_DIAG_RECOVERY_ASSUMES_HEAP}`);
}

console.log('P3 gate: reject missing host kind…');
const miss = structuredClone(base);
miss.hosts = miss.hosts.filter((h) => h.hostKind !== 'mini');
miss.mappingTable.entries = miss.mappingTable.entries.filter((e) => miss.hosts.some((h) => h.hostId === e.hostId));
fs.writeFileSync(path.join(dir, 'lifecycle-scenario.json'), JSON.stringify(miss, null, 2));
const missFail = JSON.parse(checkP3LifecycleRecoveryJson(dir));
if (missFail.status !== 'failed') fail('expected failed for missing host');
if (!(missFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE)) {
    fail(`expected ${PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE}`);
}

console.log('P3 gate: reject invalid persistence window…');
const badWin = structuredClone(base);
badWin.hosts[0].lifecycle[0].persistenceWindow = 'heap';
fs.writeFileSync(path.join(dir, 'lifecycle-scenario.json'), JSON.stringify(badWin, null, 2));
const winFail = JSON.parse(checkP3LifecycleRecoveryJson(dir));
if (winFail.status !== 'failed') fail('expected failed for persistence');
if (!(winFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID)) {
    fail(`expected ${PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P3 GATE OK: Browser/Mini/Native unified lifecycle + crash recovery without owner duplication');

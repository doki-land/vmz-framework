/**
 * P5 gate: Cross-Host Conformance — same fixture on WebSurface,
 * TemplateSurface, and Web+Native mixed host shares stable IDs, state
 * results, and trace invariants (doc 13 §4.14).
 *
 * Algebraic first version — no real DOM/mini/native adapters.
 *
 * Usage (repo root): pnpm gate:p5
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_PROTOCOL,
    checkP5CrossHostConformanceJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`P5 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('P5 gate: catalog includes conformance documents…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'conformance_fixture',
    'conformance_state_snapshot',
    'conformance_trace',
    'conformance_host_run',
    'conformance_scenario',
    'conformance_check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const code of [
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
]) {
    if (!jsCat.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'conformance_check')) {
    fail('native catalog missing conformance_check');
}

console.log('P5 gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p5-'));
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

console.log('P5 gate: checkP5CrossHostConformanceJson (web+template+mixed)…');
const report = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (report.schema !== PROFILE_CONFORMANCE_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.scenario?.schema !== PROFILE_CONFORMANCE_SCENARIO_SCHEMA) fail('scenario schema');
if (report.scenario.runs?.length !== 3) fail('expected 3 host runs');
const roles = (report.scenario.runs || [])
    .map((r) => r.surfaceRole)
    .sort()
    .join(',');
if (roles !== PROFILE_CONFORMANCE_SURFACE_ROLES.slice().sort().join(',')) {
    fail(`surface roles ${roles}`);
}
const fixtureIds = [
    ...(report.scenario.fixture.regionIds || []),
    ...(report.scenario.fixture.bindingIds || []),
    ...(report.scenario.fixture.routeIds || []),
    ...(report.scenario.fixture.slotIds || []),
].sort();
for (const run of report.scenario.runs) {
    const obs = [...(run.observedStableIds || [])].sort();
    if (JSON.stringify(obs) !== JSON.stringify([...new Set(fixtureIds)].sort())) {
        fail(`stable id mismatch on ${run.surfaceRole}`);
    }
    if (run.state?.slotValues?.[0]?.value !== '1') fail(`state on ${run.surfaceRole}`);
    if (!(run.trace?.invariantKeys?.length > 0)) fail(`trace on ${run.surfaceRole}`);
}
if (JSON.stringify(report).toLowerCase().includes('vdom')) fail('must not mention VDOM');

const wsReport = JSON.parse(ws.checkP5CrossHostConformance());
if (wsReport.schema !== PROFILE_CONFORMANCE_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const base = structuredClone(report.scenario);

console.log('P5 gate: reject stable id divergence…');
const ids = structuredClone(base);
ids.runs[0].observedStableIds.push('binding:host-private');
fs.writeFileSync(path.join(dir, 'conformance-scenario.json'), JSON.stringify(ids, null, 2));
const idsFail = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (idsFail.status !== 'failed') fail('expected failed for stable ids');
if (!(idsFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_STABLE_ID_DIVERGENCE)) {
    fail(`expected ${PROFILE_DIAG_STABLE_ID_DIVERGENCE}`);
}

console.log('P5 gate: reject state result divergence…');
const st = structuredClone(base);
st.runs[1].state.slotValues[0].value = '99';
fs.writeFileSync(path.join(dir, 'conformance-scenario.json'), JSON.stringify(st, null, 2));
const stFail = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (stFail.status !== 'failed') fail('expected failed for state');
if (!(stFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_STATE_RESULT_DIVERGENCE)) {
    fail(`expected ${PROFILE_DIAG_STATE_RESULT_DIVERGENCE}`);
}

console.log('P5 gate: reject trace invariant broken…');
const tr = structuredClone(base);
tr.runs[2].trace.invariantKeys.pop();
fs.writeFileSync(path.join(dir, 'conformance-scenario.json'), JSON.stringify(tr, null, 2));
const trFail = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (trFail.status !== 'failed') fail('expected failed for trace');
if (!(trFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_TRACE_INVARIANT_BROKEN)) {
    fail(`expected ${PROFILE_DIAG_TRACE_INVARIANT_BROKEN}`);
}

console.log('P5 gate: reject missing surface role…');
const miss = structuredClone(base);
miss.runs = miss.runs.filter((r) => r.surfaceRole !== 'template');
fs.writeFileSync(path.join(dir, 'conformance-scenario.json'), JSON.stringify(miss, null, 2));
const missFail = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (missFail.status !== 'failed') fail('expected failed for missing role');
if (!(missFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE)) {
    fail(`expected ${PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE}`);
}

console.log('P5 gate: reject mixed without native…');
const mixed = structuredClone(base);
const mrun = mixed.runs.find((r) => r.surfaceRole === 'mixed');
mrun.surfaceKinds = ['web'];
fs.writeFileSync(path.join(dir, 'conformance-scenario.json'), JSON.stringify(mixed, null, 2));
const mixedFail = JSON.parse(checkP5CrossHostConformanceJson(dir));
if (mixedFail.status !== 'failed') fail('expected failed for mixed');
if (!(mixedFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH)) {
    fail(`expected ${PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P5 GATE OK: Cross-Host Conformance stable IDs + state + trace (Web/Template/Mixed)');

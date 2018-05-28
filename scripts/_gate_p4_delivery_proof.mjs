/**
 * P4 gate: Delivery Proof — package/security/update constraints + proof
 * manifest across Browser/Mini/Native (doc 13 §4.4 / §4.12 / §4.14).
 *
 * Algebraic first version — no real packaging adapters.
 *
 * Usage (repo root): pnpm gate:p4
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_DELIVERY_PROOF_CHECK_SCHEMA,
    PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA,
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_LIFECYCLE_HOST_KINDS,
    PROFILE_PROTOCOL,
    checkP4DeliveryProofJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`P4 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('P4 gate: catalog includes delivery proof documents…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'delivery_package_constraints',
    'delivery_security_policy',
    'delivery_update_policy',
    'delivery_artifact_manifest',
    'delivery_proof_manifest',
    'delivery_proof_scenario',
    'delivery_proof_check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const code of [
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
]) {
    if (!jsCat.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'delivery_proof_check')) {
    fail('native catalog missing delivery_proof_check');
}

console.log('P4 gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p4-'));
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

console.log('P4 gate: checkP4DeliveryProofJson (browser+mini+native)…');
const report = JSON.parse(checkP4DeliveryProofJson(dir));
if (report.schema !== PROFILE_DELIVERY_PROOF_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.scenario?.schema !== PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA) fail('scenario schema');
if (report.scenario.units?.length !== 3) fail('expected 3 delivery units');
const kinds = (report.scenario.units || [])
    .map((u) => u.hostKind)
    .sort()
    .join(',');
if (kinds !== PROFILE_LIFECYCLE_HOST_KINDS.slice().sort().join(',')) {
    fail(`host kinds ${kinds}`);
}
for (const unit of report.scenario.units) {
    if (unit.proof?.artifact?.copiesSemanticIr) fail('must not copy semantic IR');
    if (!unit.proof?.updatePolicy?.requiresReproofOnSemanticChange) fail('must require reproof');
    if (!(unit.proof?.constraintProofs?.length > 0)) fail('need constraint proofs');
}
if (JSON.stringify(report).toLowerCase().includes('vdom')) fail('must not mention VDOM');

const wsReport = JSON.parse(ws.checkP4DeliveryProof());
if (wsReport.schema !== PROFILE_DELIVERY_PROOF_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const base = structuredClone(report.scenario);

console.log('P4 gate: reject package constraint exceeded…');
const bytes = structuredClone(base);
bytes.units[0].proof.artifact.estimatedPackageBytes = Number.MAX_SAFE_INTEGER;
fs.writeFileSync(path.join(dir, 'delivery-proof-scenario.json'), JSON.stringify(bytes, null, 2));
const bytesFail = JSON.parse(checkP4DeliveryProofJson(dir));
if (bytesFail.status !== 'failed') fail('expected failed for bytes');
if (!(bytesFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED)) {
    fail(`expected ${PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED}`);
}

console.log('P4 gate: reject host/plan version mismatch…');
const plan = structuredClone(base);
plan.units[1].proof.planVersion = 'plan.stale';
fs.writeFileSync(path.join(dir, 'delivery-proof-scenario.json'), JSON.stringify(plan, null, 2));
const planFail = JSON.parse(checkP4DeliveryProofJson(dir));
if (planFail.status !== 'failed') fail('expected failed for plan');
if (!(planFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH)) {
    fail(`expected ${PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH}`);
}

console.log('P4 gate: reject proof copies semantic IR…');
const ir = structuredClone(base);
ir.units[0].proof.artifact.copiesSemanticIr = true;
fs.writeFileSync(path.join(dir, 'delivery-proof-scenario.json'), JSON.stringify(ir, null, 2));
const irFail = JSON.parse(checkP4DeliveryProofJson(dir));
if (irFail.status !== 'failed') fail('expected failed for IR copy');
if (!(irFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR)) {
    fail(`expected ${PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR}`);
}

console.log('P4 gate: reject update without reproof…');
const upd = structuredClone(base);
upd.units[0].proof.updatePolicy.requiresReproofOnSemanticChange = false;
fs.writeFileSync(path.join(dir, 'delivery-proof-scenario.json'), JSON.stringify(upd, null, 2));
const updFail = JSON.parse(checkP4DeliveryProofJson(dir));
if (updFail.status !== 'failed') fail('expected failed for update');
if (!(updFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_UPDATE_WITHOUT_REPROOF)) {
    fail(`expected ${PROFILE_DIAG_UPDATE_WITHOUT_REPROOF}`);
}

console.log('P4 gate: reject insecure remote/hybrid…');
const sec = structuredClone(base);
sec.units[2].delivery.assetStrategy = 'remote';
sec.units[2].proof.securityPolicy.requiresIntegrityForRemote = false;
sec.units[2].proof.securityPolicy.allowsArbitraryRemote = true;
fs.writeFileSync(path.join(dir, 'delivery-proof-scenario.json'), JSON.stringify(sec, null, 2));
const secFail = JSON.parse(checkP4DeliveryProofJson(dir));
if (secFail.status !== 'failed') fail('expected failed for security');
if (!(secFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_SECURITY_POLICY_INSECURE)) {
    fail(`expected ${PROFILE_DIAG_SECURITY_POLICY_INSECURE}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P4 GATE OK: Delivery Proof package/security/update + proof manifest (Browser/Mini/Native)');

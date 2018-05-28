/**
 * P0 gate: HostProfile + DeliveryProfile + namespaced contribution +
 * resolution digest (doc 13 §4.5 / §4.14).
 *
 * Algebraic first version — no Surface/capability/route solver (P1),
 * no real Host adapters. MP/NW vertical gates are not substitutes.
 *
 * Usage (repo root): pnpm gate:p0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_CHECK_SCHEMA,
    PROFILE_CORE_ID_PREFIX,
    PROFILE_DELIVERY_SCHEMA,
    PROFILE_DIAG_CORE_ID_OVERRIDE,
    PROFILE_DIAG_HOST_PROFILE_INVALID,
    PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED,
    PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH,
    PROFILE_HOST_SCHEMA,
    PROFILE_PROTOCOL,
    PROFILE_SURFACE_KINDS,
    PROFILE_UNIFIED_LIFECYCLE_EVENTS,
    checkP0ProfileProtocolJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`P0 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('P0 gate: profile protocol catalog…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'host_profile',
    'delivery_profile',
    'surface_binding',
    'capability_binding',
    'lifecycle_binding',
    'navigation_binding',
    'transport_binding',
    'resolution_digest',
    'contribution',
    'check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const k of PROFILE_SURFACE_KINDS) {
    if (!jsCat.surfaceKinds.includes(k)) fail(`missing surface kind ${k}`);
}
for (const e of PROFILE_UNIFIED_LIFECYCLE_EVENTS) {
    if (!jsCat.unifiedLifecycleEvents.includes(e)) fail(`missing lifecycle ${e}`);
}
if (jsCat.coreIdPrefix !== PROFILE_CORE_ID_PREFIX) fail('coreIdPrefix');
if (!jsCat.diagnostics.includes(PROFILE_DIAG_HOST_PROFILE_INVALID)) fail('missing HOST_PROFILE_INVALID');
if (!jsCat.diagnostics.includes(PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH)) fail('missing DIGEST_MISMATCH');

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (nativeCat.protocol !== PROFILE_PROTOCOL) fail('native catalog protocol');
if (!nativeCat.documents?.some((d) => d.kind === 'host_profile')) fail('native missing host_profile');

console.log('P0 gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p0-'));
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
const clientJs = path.join(outDir, 'pages', 'index.client.js');
if (!fs.existsSync(clientJs) || !fs.readFileSync(clientJs, 'utf8').includes('__vmzDirect')) {
    fail('Browser Direct baseline missing');
}

console.log('P0 gate: checkP0ProfileProtocolJson (default browser example)…');
const report = JSON.parse(checkP0ProfileProtocolJson(dir));
if (report.schema !== PROFILE_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.hostProfile?.schema !== PROFILE_HOST_SCHEMA) fail('host schema');
if (report.deliveryProfile?.schema !== PROFILE_DELIVERY_SCHEMA) fail('delivery schema');
if (!report.deliveryProfile?.resolutionDigest) fail('missing digest');
if (report.hostProfile.constraints?.allowsRuntimeDriverSelect) fail('runtime select must be false');
if (report.hostProfile.lifecycle?.length < 7) fail('unified lifecycle incomplete');

const wsReport = JSON.parse(ws.checkP0ProfileProtocol());
if (wsReport.schema !== PROFILE_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('P0 gate: reject runtime driver select…');
const host = structuredClone(report.hostProfile);
host.constraints.allowsRuntimeDriverSelect = true;
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(host, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(report.deliveryProfile, null, 2));
const rtFail = JSON.parse(checkP0ProfileProtocolJson(dir));
if (rtFail.status !== 'failed') fail('expected failed for runtime select');
if (!(rtFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_HOST_PROFILE_INVALID)) {
    fail(`expected ${PROFILE_DIAG_HOST_PROFILE_INVALID}`);
}

console.log('P0 gate: reject digest mismatch…');
const hostOk = structuredClone(report.hostProfile);
const delivery = structuredClone(report.deliveryProfile);
delivery.resolutionDigest.value = 'sha256:tampered';
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(hostOk, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(delivery, null, 2));
const digFail = JSON.parse(checkP0ProfileProtocolJson(dir));
if (digFail.status !== 'failed') fail('expected failed for digest mismatch');
if (!(digFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH)) {
    fail(`expected ${PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH}`);
}

console.log('P0 gate: reject core id override…');
fs.unlinkSync(path.join(dir, 'host-profile.json'));
fs.unlinkSync(path.join(dir, 'delivery-profile.json'));
fs.writeFileSync(
    path.join(dir, 'profile-contribution.json'),
    JSON.stringify(
        {
            schema: 'vmz.profile.contribution.v0',
            pluginNamespace: 'com.example',
            surfaceIds: ['vmz.surface.web.main'],
            capabilityIds: [],
            providerIds: [],
        },
        null,
        2,
    ),
);
const coreFail = JSON.parse(checkP0ProfileProtocolJson(dir));
if (coreFail.status !== 'failed') fail('expected failed for core override');
if (!(coreFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CORE_ID_OVERRIDE)) {
    fail(`expected ${PROFILE_DIAG_CORE_ID_OVERRIDE}`);
}

console.log('P0 gate: reject unresolved hostProfileRef…');
fs.unlinkSync(path.join(dir, 'profile-contribution.json'));
const host2 = structuredClone(report.hostProfile);
const del2 = structuredClone(report.deliveryProfile);
del2.hostProfileRef = 'vmz.host.missing';
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(host2, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(del2, null, 2));
const refFail = JSON.parse(checkP0ProfileProtocolJson(dir));
if (refFail.status !== 'failed') fail('expected failed for unresolved ref');
if (!(refFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED)) {
    fail(`expected ${PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P0 GATE OK: HostProfile + DeliveryProfile + namespaced contribution + resolution digest (no solver yet)');

/**
 * native: typed NativeCapabilityCall + first-batch stubs
 * (camera/file/share/storage) + origin/nonce/permission/timeout/cancel/trace.
 *
 * Algebraic first version — no real-device adapters.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_BRIDGE_CHECK_SCHEMA,
    NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA,
    NATIVE_HOST_CAPABILITY_CALL_SCHEMA,
    NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
    NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED,
    NATIVE_HOST_DIAG_MISSING_NONCE,
    NATIVE_HOST_FIRST_BATCH_STUB_IDS,
    NATIVE_HOST_PROTOCOL,
    checkNativeBridgeContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`native GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('native gate: catalog includes capability_call + stubs…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const [kind, schema] of [
    ['capability_call', NATIVE_HOST_CAPABILITY_CALL_SCHEMA],
    ['bridge_stub_catalog', NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA],
    ['bridge_check', NATIVE_HOST_BRIDGE_CHECK_SCHEMA],
]) {
    const row = jsCat.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const id of NATIVE_HOST_FIRST_BATCH_STUB_IDS) {
    if (!jsCat.firstBatchStubIds?.includes(id)) fail(`missing stub id ${id}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_MISSING_NONCE)) {
    fail('missing nonce diagnostic');
}

const nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'capability_call')) {
    fail('native catalog missing capability_call');
}
if (!Array.isArray(nativeCat.firstBatchStubIds) || nativeCat.firstBatchStubIds.length < 5) {
    fail('native firstBatchStubIds incomplete');
}

console.log('native gate: Browser Direct smoke (Web artifact still baseline)…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw2-'));
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

console.log('native gate: checkNativeBridgeContractJson (example stubs + camera call)…');
const report = JSON.parse(checkNativeBridgeContractJson(dir));
if (report.schema !== NATIVE_HOST_BRIDGE_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.stubCatalog?.schema !== NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA) fail('stub catalog schema');
if ((report.stubCatalog?.allowlist || []).length !== 5) fail('expected 5 first-batch stubs');
for (const id of NATIVE_HOST_FIRST_BATCH_STUB_IDS) {
    if (!report.stubCatalog.allowlist.includes(id)) fail(`missing allowlist ${id}`);
}
const sample = report.sampleCalls?.[0];
if (!sample || sample.schema !== NATIVE_HOST_CAPABILITY_CALL_SCHEMA) fail('sample call schema');
if (sample.capabilityId !== 'camera.capture') fail('expected camera.capture sample');
if (!sample.nonce || !sample.origin || !sample.cancellation || !sample.timeoutMs) {
    fail('sample call missing security fields');
}
if (JSON.stringify(report).toLowerCase().includes('react-native')) {
    fail('must not mention react-native');
}

const wsReport = JSON.parse(ws.checkNativeBridgeContract());
if (wsReport.schema !== NATIVE_HOST_BRIDGE_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('native gate: reject missing nonce…');
fs.writeFileSync(
    path.join(dir, 'native-bridge.calls.json'),
    JSON.stringify([
        {
            ...sample,
            nonce: '',
        },
    ]),
);
const nonceFail = JSON.parse(checkNativeBridgeContractJson(dir));
if (nonceFail.status !== 'failed') fail('expected failed for missing nonce');
if (!(nonceFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_MISSING_NONCE)) {
    fail(`expected ${NATIVE_HOST_DIAG_MISSING_NONCE}`);
}

console.log('native gate: reject not-allowlisted capability…');
fs.writeFileSync(
    path.join(dir, 'native-bridge.calls.json'),
    JSON.stringify([
        {
            ...sample,
            capabilityId: 'payment.charge',
            nonce: 'n1',
        },
    ]),
);
const allowFail = JSON.parse(checkNativeBridgeContractJson(dir));
if (allowFail.status !== 'failed') fail('expected failed for allowlist miss');
if (!(allowFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED)) {
    fail(`expected ${NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED}`);
}

console.log('native gate: reject arbitrary bridge foul…');
fs.unlinkSync(path.join(dir, 'native-bridge.calls.json'));
fs.writeFileSync(path.join(dir, 'native-bridge.foul.json'), JSON.stringify({ note: 'window.native = {}; eval(nativeCode)' }));
const foul = JSON.parse(checkNativeBridgeContractJson(dir));
if (foul.status !== 'failed') fail('expected failed for foul');
if (!(foul.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_ARBITRARY_BRIDGE)) {
    fail(`expected ${NATIVE_HOST_DIAG_ARBITRARY_BRIDGE}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('native GATE OK: capability_call + first-batch stubs + origin/nonce/cancel/trace + foul rejects');

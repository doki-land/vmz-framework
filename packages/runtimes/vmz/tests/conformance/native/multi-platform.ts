/**
 * native: iOS/Android share one Host Profile contract set
 * (bridge / surface / shell / deployment / fullstack / test).
 * Reject platform semantic forks and packaging adapters as semantic cores.
 *
 * Algebraic first version — no real Xcode/Gradle adapters yet.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_BRIDGE_SCHEMA,
    NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE,
    NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER,
    NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND,
    NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA,
    NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_REQUIRED_MULTI_PLATFORMS,
    checkMultiPlatformContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`native GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('native gate: catalog includes multi_platform documents…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const kind of ['multi_platform', 'multi_platform_shared', 'multi_platform_adapter', 'multi_platform_test', 'multi_platform_check']) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const p of NATIVE_HOST_REQUIRED_MULTI_PLATFORMS) {
    if (!jsCat.requiredMultiPlatforms?.includes(p)) fail(`missing platform ${p}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK)) {
    fail('missing platform_semantic_fork diagnostic');
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA)) {
    fail('missing platform_private_schema diagnostic');
}

const nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'multi_platform')) {
    fail('native catalog missing multi_platform');
}
if (!nativeCat.requiredMultiPlatforms?.includes('ios') || !nativeCat.requiredMultiPlatforms?.includes('android')) {
    fail('native catalog requiredMultiPlatforms');
}

console.log('native gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw6-'));
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

const shared = {
    schema: NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA,
    bridgeSchema: NATIVE_HOST_BRIDGE_SCHEMA,
    capabilityCallSchema: 'vmz.native_host.capability_call.v0',
    surfaceSchema: NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    shellSchema: 'vmz.native_host.shell.v0',
    deploymentSchema: 'vmz.native_host.webview_deployment.v0',
    fullstackSchema: 'vmz.native_host.fullstack.v0',
    testContractSchema: 'vmz.native_host.multi_platform_test.v0',
};

function adapter(platform) {
    return {
        schema: 'vmz.native_host.multi_platform_adapter.v0',
        platform,
        kind: NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND,
        bridgeSchema: shared.bridgeSchema,
        capabilityCallSchema: shared.capabilityCallSchema,
        surfaceSchema: shared.surfaceSchema,
        shellSchema: shared.shellSchema,
        deploymentSchema: shared.deploymentSchema,
        fullstackSchema: shared.fullstackSchema,
        testContractSchema: shared.testContractSchema,
        packagingOnly: true,
        isSemanticTruthSource: false,
    };
}

const manifest = {
    schema: NATIVE_HOST_MULTI_PLATFORM_SCHEMA,
    shared,
    platforms: [...NATIVE_HOST_REQUIRED_MULTI_PLATFORMS],
    adapters: NATIVE_HOST_REQUIRED_MULTI_PLATFORMS.map(adapter),
    allowsPlatformSemanticFork: false,
};
fs.writeFileSync(path.join(dir, 'native-multi-platform.json'), JSON.stringify(manifest, null, 2));

console.log('native gate: checkMultiPlatformContractJson…');
const report = JSON.parse(checkMultiPlatformContractJson(dir));
if (report.schema !== NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.multi_platform?.schema !== NATIVE_HOST_MULTI_PLATFORM_SCHEMA) fail('manifest schema');
if (report.multi_platform.adapters?.length !== 2) fail('expected ios+android adapters');
if (report.multi_platform.shared?.bridgeSchema !== NATIVE_HOST_BRIDGE_SCHEMA) fail('shared bridge');
if (report.multi_platform.shared?.surfaceSchema !== NATIVE_HOST_NATIVE_SURFACE_SCHEMA) {
    fail('shared surface');
}
if (report.multi_platform.allowsPlatformSemanticFork) fail('must not allow semantic fork');
if (JSON.stringify(report).toLowerCase().includes('react-native')) {
    fail('must not mention react-native as architecture template');
}

const wsReport = JSON.parse(ws.checkMultiPlatformContract());
if (wsReport.schema !== NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('native gate: reject platform semantic fork…');
const forked = structuredClone(manifest);
forked.adapters.find((a) => a.platform === 'android').bridgeSchema = 'com.android.private.bridge';
fs.writeFileSync(path.join(dir, 'native-multi-platform.json'), JSON.stringify(forked, null, 2));
const forkFail = JSON.parse(checkMultiPlatformContractJson(dir));
if (forkFail.status !== 'failed') fail('expected failed for semantic fork');
if (
    !(forkFail.diagnostics || []).some(
        (d) => d.code === NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK || d.code === NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
    )
) {
    fail(`expected fork/private diagnostic, got ${JSON.stringify(forkFail.diagnostics)}`);
}

console.log('native gate: reject missing android adapter…');
const missing = structuredClone(manifest);
missing.platforms = ['ios'];
missing.adapters = [adapter('ios')];
fs.writeFileSync(path.join(dir, 'native-multi-platform.json'), JSON.stringify(missing, null, 2));
const missFail = JSON.parse(checkMultiPlatformContractJson(dir));
if (missFail.status !== 'failed') fail('expected failed for missing android');
if (!(missFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER)) {
    fail(`expected ${NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER}`);
}

console.log('native gate: reject adapter as semantic core…');
const core = structuredClone(manifest);
for (const a of core.adapters) {
    a.kind = 'xcode_project';
    a.packagingOnly = false;
    a.isSemanticTruthSource = true;
}
fs.writeFileSync(path.join(dir, 'native-multi-platform.json'), JSON.stringify(core, null, 2));
const coreFail = JSON.parse(checkMultiPlatformContractJson(dir));
if (coreFail.status !== 'failed') fail('expected failed for semantic-core adapter');
if (!(coreFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE)) {
    fail(`expected ${NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('native GATE OK: ios+android shared bridge/surface/deployment/test schemas + no platform semantic fork (packaging stubs only)');

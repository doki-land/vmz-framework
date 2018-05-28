/**
 * NW0 gate: WebViewDeploymentProfile + NativeCapability + typed bridge +
 * application identity; reject arbitrary JS bridges; prove Browser artifact reuse.
 *
 * Design: `规划设计/vmz/27` §10 NW0.
 * No iOS/Android shell — protocol + check only.
 *
 * Usage (repo root): pnpm gate:nw0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA,
    NATIVE_HOST_BRIDGE_SCHEMA,
    NATIVE_HOST_CAPABILITY_SCHEMA,
    NATIVE_HOST_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA,
    checkNw0NativeHostContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`NW0 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('NW0 gate: native-host protocol catalog…');
const jsCat = nativeHostCatalog();
if (jsCat.schema !== NATIVE_HOST_PROTOCOL || jsCat.protocol !== NATIVE_HOST_PROTOCOL) {
    fail('JS nativeHostCatalog protocol mismatch');
}
for (const [kind, schema] of [
    ['webview_deployment', NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA],
    ['capability', NATIVE_HOST_CAPABILITY_SCHEMA],
    ['bridge', NATIVE_HOST_BRIDGE_SCHEMA],
    ['application_identity', NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA],
    ['check', NATIVE_HOST_CHECK_SCHEMA],
]) {
    const row = jsCat.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const cls of ['PureWeb', 'NativeBacked', 'NativeSurface', 'ServerBacked', 'Unsupported']) {
    if (!jsCat.capabilityClasses.includes(cls)) fail(`missing capability class ${cls}`);
}
if (!jsCat.forbiddenBridgePatterns.includes('window.native')) {
    fail('missing forbidden pattern window.native');
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_ARBITRARY_BRIDGE)) {
    fail('missing arbitrary_bridge diagnostic');
}

let nativeCat;
try {
    nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
} catch (e) {
    fail(`native catalog: ${e}`);
}
if (nativeCat.protocol !== NATIVE_HOST_PROTOCOL) fail('native catalog protocol');
if (!Array.isArray(nativeCat.capabilityClasses) || nativeCat.capabilityClasses.length < 5) {
    fail('native capabilityClasses incomplete');
}
if (!Array.isArray(nativeCat.forbiddenBridgePatterns) || !nativeCat.forbiddenBridgePatterns.includes('window.native')) {
    fail('native forbiddenBridgePatterns incomplete');
}

console.log('NW0 gate: Browser Direct build smoke (Web artifact reuse)…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw0-'));
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
if (!fs.existsSync(clientJs)) fail('missing Browser Direct client emit');
const clientText = fs.readFileSync(clientJs, 'utf8');
if (!clientText.includes('__vmzDirect')) {
    fail('Browser Direct emit missing __vmzDirect — WebView must reuse this artifact');
}
if (!fs.existsSync(path.join(outDir, 'vmz-dom.js'))) {
    fail('missing Browser DOM host artifact vmz-dom.js');
}

console.log('NW0 gate: checkNw0NativeHostContractJson (example profile)…');
const report = JSON.parse(checkNw0NativeHostContractJson(dir));
if (report.schema !== NATIVE_HOST_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
const dep = report.webviewDeployment;
if (!dep || dep.schema !== NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA) fail('webviewDeployment schema');
if (dep.reusesBrowserLowering !== true) fail('reusesBrowserLowering must be true');
if (dep.planSchema !== 'vmz.plan.v0') fail(`planSchema ${dep.planSchema}`);
if (dep.assetMode !== 'local') fail(`assetMode should be local for NW0 example, got ${dep.assetMode}`);
if (!dep.identity?.applicationId || !dep.identity?.origin) fail('missing identity');
if (dep.bridge?.mode !== 'typed_capability') fail('bridge.mode');
if (!Array.isArray(dep.capabilities) || !dep.capabilities.some((c) => c.id === 'camera.capture')) {
    fail('expected camera.capture NativeBacked capability');
}
if (JSON.stringify(report).toLowerCase().includes('wechat') || JSON.stringify(report).includes('react-native')) {
    fail('core NW0 schema must not mention wechat / react-native');
}

const wsReport = JSON.parse(ws.checkNw0NativeHostContract());
if (wsReport.schema !== NATIVE_HOST_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('NW0 gate: reject arbitrary bridge foul fixture…');
fs.writeFileSync(
    path.join(dir, 'native-host.bridge.foul.json'),
    JSON.stringify({
        mode: 'arbitrary',
        note: 'window.native = {}; window.webkit.messageHandlers.vmz',
    }),
);
const fouled = JSON.parse(checkNw0NativeHostContractJson(dir));
if (fouled.status !== 'failed') fail('expected failed status for arbitrary bridge foul');
if (!(fouled.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_ARBITRARY_BRIDGE)) {
    fail(`expected ${NATIVE_HOST_DIAG_ARBITRARY_BRIDGE}: ${JSON.stringify(fouled.diagnostics)}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('NW0 GATE OK: WebViewDeployment + NativeCapability + typed bridge + identity + Browser artifact reuse + arbitrary-bridge reject');

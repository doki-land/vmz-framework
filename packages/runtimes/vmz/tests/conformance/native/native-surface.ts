/**
 * native: NativeSurfaceId + owner RegionId + lifetime; camera.preview
 * high-value surface; NativeSurface ≠ capability; no implicit WebView state share.
 *
 * Algebraic first version — no UIKit/Android View adapter yet.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE,
    NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY,
    NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS,
    NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA,
    NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    NATIVE_HOST_PROTOCOL,
    checkNativeSurfaceContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`native GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('native gate: catalog includes native_surface documents…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const kind of ['native_surface', 'native_surface_id', 'native_surface_check']) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const k of NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS) {
    if (!jsCat.highValueSurfaceKinds?.includes(k)) fail(`missing kind ${k}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY)) {
    fail('missing surface_is_capability diagnostic');
}

const nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'native_surface')) {
    fail('native catalog missing native_surface');
}

console.log('native gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw5-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <button @click="increment">{{ n }}</button>
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

const surface = {
    schema: NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    surfaceId: 'surface:camera.preview:page.index',
    kind: 'camera',
    ownerRegionId: 'region:pages/index:camera',
    lifetime: 'bound_to_region',
    disposeOnOwnerDestroy: true,
    sharesImplicitWebViewState: false,
    confusedWithCapability: false,
    isSemanticTruthSource: false,
    planSchema: 'vmz.plan.v0',
    reusesViewOperations: true,
    boundary: {
        schema: 'vmz.native_host.native_surface_boundary.v0',
        serializable: true,
        schemaVersion: '1',
        traceRequired: true,
    },
    relatedCapabilityId: 'camera.capture',
};
fs.writeFileSync(path.join(dir, 'native-surface.json'), JSON.stringify(surface, null, 2));

console.log('native gate: checkNativeSurfaceContractJson…');
const report = JSON.parse(checkNativeSurfaceContractJson(dir));
if (report.schema !== NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.surface?.schema !== NATIVE_HOST_NATIVE_SURFACE_SCHEMA) fail('surface schema');
if (report.surface.kind !== 'camera') fail('expected camera surface');
if (!report.surface.surfaceId) fail('surfaceId');
if (!report.surface.ownerRegionId) fail('ownerRegionId');
if (report.surface.confusedWithCapability) fail('must not confuse with capability');
if (report.surface.sharesImplicitWebViewState) fail('must not share implicit state');
if (report.surface.relatedCapabilityId !== 'camera.capture') fail('related capability');
if (JSON.stringify(report).toLowerCase().includes('react-native')) {
    fail('must not mention react-native as architecture template');
}

const wsReport = JSON.parse(ws.checkNativeSurfaceContract());
if (wsReport.schema !== NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('native gate: reject implicit WebView state share…');
const share = structuredClone(surface);
share.sharesImplicitWebViewState = true;
fs.writeFileSync(path.join(dir, 'native-surface.json'), JSON.stringify(share, null, 2));
const shareFail = JSON.parse(checkNativeSurfaceContractJson(dir));
if (shareFail.status !== 'failed') fail('expected failed for state share');
if (!(shareFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE)) {
    fail(`expected ${NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE}`);
}

console.log('native gate: reject surface confused with capability…');
const conf = structuredClone(surface);
conf.confusedWithCapability = true;
fs.writeFileSync(path.join(dir, 'native-surface.json'), JSON.stringify(conf, null, 2));
const confFail = JSON.parse(checkNativeSurfaceContractJson(dir));
if (confFail.status !== 'failed') fail('expected failed for capability confusion');
if (!(confFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY)) {
    fail(`expected ${NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY}`);
}

console.log('native gate: reject semantic-truth surface…');
const truth = structuredClone(surface);
truth.isSemanticTruthSource = true;
fs.writeFileSync(path.join(dir, 'native-surface.json'), JSON.stringify(truth, null, 2));
const truthFail = JSON.parse(checkNativeSurfaceContractJson(dir));
if (truthFail.status !== 'failed') fail('expected failed for semantic truth');
if (!(truthFail.diagnostics || []).some((d) => d.code === 'vmz::native_host::surface_is_semantic_truth')) {
    fail('expected surface_is_semantic_truth');
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('native GATE OK: NativeSurfaceId + owner/lifetime + camera.preview + surface≠capability + no implicit state share');

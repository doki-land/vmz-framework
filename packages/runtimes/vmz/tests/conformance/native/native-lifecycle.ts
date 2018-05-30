/**
 * native: App lifecycle events + persistence + update/rollback + offline.
 * Hard rules: background ≠ destroy; crash restore must not assume JS heap.
 *
 * Algebraic first version — no real-device lifecycle driver yet.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY,
    NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP,
    NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT,
    NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA,
    NATIVE_HOST_LIFECYCLE_SCHEMA,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS,
    checkNativeLifecycleContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`native GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('native gate: catalog includes lifecycle documents…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const [kind, schema] of [
    ['lifecycle', NATIVE_HOST_LIFECYCLE_SCHEMA],
    ['lifecycle_check', NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA],
]) {
    const row = jsCat.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const ev of NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS) {
    if (!jsCat.requiredLifecycleEvents?.includes(ev)) fail(`missing event ${ev}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY)) {
    fail('missing background_is_destroy diagnostic');
}

const nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'lifecycle')) {
    fail('native catalog missing lifecycle');
}
if (!Array.isArray(nativeCat.requiredLifecycleEvents) || nativeCat.requiredLifecycleEvents.length < 9) {
    fail('native requiredLifecycleEvents incomplete');
}

console.log('native gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw3-'));
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

const policy = {
    schema: NATIVE_HOST_LIFECYCLE_SCHEMA,
    events: [...NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS],
    backgroundEqualsDestroy: false,
    crashRestoreAssumesJsHeap: false,
    disposeRegionsOnDestroy: true,
    persistence: {
        schema: 'vmz.native_host.persistence.v0',
        enabled: true,
        mode: 'capability_backed',
        reauthOnRestore: true,
    },
    update: {
        schema: 'vmz.native_host.update_policy.v0',
        channel: 'store',
        rollback: 'previous_bundle',
    },
    offline: {
        schema: 'vmz.native_host.offline_policy.v0',
        mode: 'bundled_only',
    },
};
fs.writeFileSync(path.join(dir, 'native-lifecycle.json'), JSON.stringify(policy, null, 2));

console.log('native gate: checkNativeLifecycleContractJson…');
const report = JSON.parse(checkNativeLifecycleContractJson(dir));
if (report.schema !== NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.lifecycle?.schema !== NATIVE_HOST_LIFECYCLE_SCHEMA) fail('lifecycle schema');
if (report.lifecycle.backgroundEqualsDestroy !== false) fail('backgroundEqualsDestroy');
if (report.lifecycle.crashRestoreAssumesJsHeap !== false) fail('crashRestoreAssumesJsHeap');
if (!report.lifecycle.persistence?.enabled) fail('persistence');
if (!report.lifecycle.update?.rollback) fail('update.rollback');
if (report.lifecycle.offline?.mode !== 'bundled_only') fail('offline.mode');

const wsReport = JSON.parse(ws.checkNativeLifecycleContract());
if (wsReport.schema !== NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('native gate: reject backgroundEqualsDestroy…');
const badBg = structuredClone(policy);
badBg.backgroundEqualsDestroy = true;
fs.writeFileSync(path.join(dir, 'native-lifecycle.json'), JSON.stringify(badBg, null, 2));
const bgFail = JSON.parse(checkNativeLifecycleContractJson(dir));
if (bgFail.status !== 'failed') fail('expected failed for background=destroy');
if (!(bgFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY)) {
    fail(`expected ${NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY}`);
}

console.log('native gate: reject crashRestoreAssumesJsHeap…');
const badCrash = structuredClone(policy);
badCrash.crashRestoreAssumesJsHeap = true;
fs.writeFileSync(path.join(dir, 'native-lifecycle.json'), JSON.stringify(badCrash, null, 2));
const crashFail = JSON.parse(checkNativeLifecycleContractJson(dir));
if (crashFail.status !== 'failed') fail('expected failed for js-heap assumption');
if (!(crashFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP)) {
    fail(`expected ${NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP}`);
}

console.log('native gate: reject missing lifecycle event…');
const missing = structuredClone(policy);
missing.events = missing.events.filter((e) => e !== 'restore');
fs.writeFileSync(path.join(dir, 'native-lifecycle.json'), JSON.stringify(missing, null, 2));
const missFail = JSON.parse(checkNativeLifecycleContractJson(dir));
if (missFail.status !== 'failed') fail('expected failed for missing restore');
if (!(missFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT)) {
    fail(`expected ${NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('native GATE OK: lifecycle events + persistence/update/offline + background≠destroy + crash≠js-heap');

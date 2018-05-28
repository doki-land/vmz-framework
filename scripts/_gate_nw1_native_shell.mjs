/**
 * NW1 gate: Native WebView shell + local bundled Browser Direct entry +
 * load/error/exit/deepLink/log hooks + dual ios/android adapters (shared schema).
 *
 * Design: `规划设计/vmz/27` §10 NW1.
 * Algebraic first version — no Xcode/Gradle projects.
 *
 * Usage (repo root): pnpm gate:nw1
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT,
    NATIVE_HOST_DIAG_MISSING_SHELL_HOOK,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT,
    NATIVE_HOST_LOCAL_BUNDLE_SCHEMA,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_REQUIRED_SHELL_HOOKS,
    NATIVE_HOST_SHELL_CHECK_SCHEMA,
    NATIVE_HOST_SHELL_SCHEMA,
    checkNw1NativeShellContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`NW1 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('NW1 gate: native-host catalog includes shell documents…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const [kind, schema] of [
    ['shell', NATIVE_HOST_SHELL_SCHEMA],
    ['shell_check', NATIVE_HOST_SHELL_CHECK_SCHEMA],
    ['local_bundle', NATIVE_HOST_LOCAL_BUNDLE_SCHEMA],
]) {
    const row = jsCat.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const hook of NATIVE_HOST_REQUIRED_SHELL_HOOKS) {
    if (!jsCat.requiredShellHooks?.includes(hook)) fail(`missing required hook ${hook}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_MISSING_SHELL_HOOK)) {
    fail('missing shell hook diagnostic');
}

let nativeCat;
try {
    nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
} catch (e) {
    fail(`native catalog: ${e}`);
}
if (!nativeCat.documents?.some((d) => d.kind === 'shell' && d.schema === NATIVE_HOST_SHELL_SCHEMA)) {
    fail('native catalog missing shell document');
}

console.log('NW1 gate: Browser Direct build + write native-shell.json…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw1-'));
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
const domHost = path.join(outDir, 'vmz-dom.js');
if (!fs.existsSync(clientJs)) fail('missing Browser Direct client emit');
if (!fs.readFileSync(clientJs, 'utf8').includes('__vmzDirect')) {
    fail('missing __vmzDirect marker');
}
if (!fs.existsSync(domHost)) fail('missing vmz-dom.js');

const shell = {
    schema: NATIVE_HOST_SHELL_SCHEMA,
    identity: {
        schema: 'vmz.native_host.application_identity.v0',
        applicationId: 'demo.app',
        origin: 'app://demo.app',
        bundleId: 'com.vmz.demo',
        version: '0.0.0',
    },
    assetMode: 'local',
    reusesBrowserLowering: true,
    planSchema: 'vmz.plan.v0',
    entry: {
        schema: NATIVE_HOST_LOCAL_BUNDLE_SCHEMA,
        clientJs: 'pages/index.client.js',
        domHost: 'vmz-dom.js',
        entryUrl: 'app://demo.app/',
    },
    hooks: [...NATIVE_HOST_REQUIRED_SHELL_HOOKS],
    deepLinks: [
        {
            schema: 'vmz.native_host.deep_link.v0',
            scheme: 'app',
            host: 'demo.app',
            path: '/',
            routeId: 'pages/index',
        },
    ],
    logging: { level: 'info', redactSensitive: true },
    adapters: [
        { platform: 'ios', kind: 'webview_shell', shellSchema: NATIVE_HOST_SHELL_SCHEMA },
        { platform: 'android', kind: 'webview_shell', shellSchema: NATIVE_HOST_SHELL_SCHEMA },
    ],
};
fs.writeFileSync(path.join(dir, 'native-shell.json'), JSON.stringify(shell, null, 2));

console.log('NW1 gate: checkNw1NativeShellContractJson…');
const report = JSON.parse(checkNw1NativeShellContractJson(dir));
if (report.schema !== NATIVE_HOST_SHELL_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.shell?.schema !== NATIVE_HOST_SHELL_SCHEMA) fail('shell schema');
if (report.shell?.reusesBrowserLowering !== true) fail('reusesBrowserLowering');
if (report.shell?.assetMode !== 'local') fail('assetMode');
if (report.shell?.adapters?.length !== 2) fail('need ios+android adapters');
if (JSON.stringify(report).toLowerCase().includes('react-native')) {
    fail('must not mention react-native');
}

const wsReport = JSON.parse(ws.checkNw1NativeShellContract());
if (wsReport.schema !== NATIVE_HOST_SHELL_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('NW1 gate: reject remote https entry…');
const remote = structuredClone(shell);
remote.entry.entryUrl = 'https://cdn.example.com/app';
fs.writeFileSync(path.join(dir, 'native-shell.json'), JSON.stringify(remote, null, 2));
const remoteReport = JSON.parse(checkNw1NativeShellContractJson(dir));
if (remoteReport.status !== 'failed') fail('expected failed for remote entry');
if (!(remoteReport.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT)) {
    fail(`expected ${NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT}`);
}

console.log('NW1 gate: reject missing shell hook…');
const noHook = structuredClone(shell);
noHook.hooks = noHook.hooks.filter((h) => h !== 'deepLink');
fs.writeFileSync(path.join(dir, 'native-shell.json'), JSON.stringify(noHook, null, 2));
const hookReport = JSON.parse(checkNw1NativeShellContractJson(dir));
if (hookReport.status !== 'failed') fail('expected failed for missing hook');
if (!(hookReport.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_MISSING_SHELL_HOOK)) {
    fail(`expected ${NATIVE_HOST_DIAG_MISSING_SHELL_HOOK}`);
}

console.log('NW1 gate: reject platform schema fork…');
const forked = structuredClone(shell);
forked.adapters = [
    { platform: 'ios', kind: 'webview_shell', shellSchema: NATIVE_HOST_SHELL_SCHEMA },
    {
        platform: 'android',
        kind: 'webview_shell',
        shellSchema: 'com.vendor.android.private.shell',
    },
];
fs.writeFileSync(path.join(dir, 'native-shell.json'), JSON.stringify(forked, null, 2));
const forkReport = JSON.parse(checkNw1NativeShellContractJson(dir));
if (forkReport.status !== 'failed') fail('expected failed for platform fork');
if (!(forkReport.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK)) {
    fail(`expected ${NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK}`);
}

console.log('NW1 gate: reject missing entry artifact…');
fs.writeFileSync(path.join(dir, 'native-shell.json'), JSON.stringify(shell, null, 2));
fs.unlinkSync(clientJs);
const missing = JSON.parse(checkNw1NativeShellContractJson(dir));
if (missing.status !== 'failed') fail('expected failed for missing client artifact');
if (!(missing.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT)) {
    fail(`expected ${NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('NW1 GATE OK: shell + local bundle + hooks + ios/android shared schema + Browser Direct entry + foul rejects');

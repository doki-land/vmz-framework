/**
 * native: SSR first-paint + #server transport + auth/session + network +
 * remote/hybrid integrity. Native bridge must not bypass #server.
 *
 * Algebraic first version — no store packaging / push provider yet.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER,
    NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY,
    NATIVE_HOST_FULLSTACK_CHECK_SCHEMA,
    NATIVE_HOST_FULLSTACK_SCHEMA,
    NATIVE_HOST_PROTOCOL,
    checkNativeFullstackContractJson,
    createWorkspace,
    nativeHostCatalog,
    queryNativeHostProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`native GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('native gate: catalog includes fullstack documents…');
const jsCat = nativeHostCatalog();
if (jsCat.protocol !== NATIVE_HOST_PROTOCOL) fail('JS catalog protocol');
for (const kind of ['fullstack', 'ssr_first_paint', 'server_transport', 'auth_session', 'fullstack_check']) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
if (!jsCat.diagnostics.includes(NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER)) {
    fail('missing bridge_bypasses_server diagnostic');
}

const nativeCat = JSON.parse(queryNativeHostProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'fullstack' && d.schema === NATIVE_HOST_FULLSTACK_SCHEMA)) {
    fail('native catalog missing fullstack');
}

console.log('native gate: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-nw4-'));
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

const profile = {
    schema: NATIVE_HOST_FULLSTACK_SCHEMA,
    ssr: {
        schema: 'vmz.native_host.ssr_first_paint.v0',
        enabled: true,
        mode: 'bundled',
        planSchema: 'vmz.plan.v0',
        integrity: '',
        allowMixedCookieAssumptions: false,
    },
    serverTransport: {
        schema: 'vmz.native_host.server_transport.v0',
        scheme: '#server',
        endpoint: '#server/rpc',
        bridgeBypassesServer: false,
    },
    auth: {
        schema: 'vmz.native_host.auth_session.v0',
        mode: 'cookie+token',
        sessionNamespace: 'app://demo.app/session',
        reauthOnWebViewCrash: true,
    },
    push: {
        schema: 'vmz.native_host.push_policy.v0',
        capabilityId: 'push.subscribe',
        stub: true,
    },
    network: {
        schema: 'vmz.native_host.network_policy.v0',
        mode: 'https_only',
        allowCleartext: false,
    },
    deliveryAssetMode: 'local',
    deliveryIntegrity: '',
};
fs.writeFileSync(path.join(dir, 'native-fullstack.json'), JSON.stringify(profile, null, 2));

console.log('native gate: checkNativeFullstackContractJson…');
const report = JSON.parse(checkNativeFullstackContractJson(dir));
if (report.schema !== NATIVE_HOST_FULLSTACK_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.fullstack?.schema !== NATIVE_HOST_FULLSTACK_SCHEMA) fail('fullstack schema');
if (report.fullstack.serverTransport?.scheme !== '#server') fail('server scheme');
if (report.fullstack.serverTransport?.bridgeBypassesServer !== false) fail('bypass must be false');
if (report.fullstack.ssr?.mode !== 'bundled') fail('ssr.mode');
if (report.fullstack.ssr?.planSchema !== 'vmz.plan.v0') fail('ssr.planSchema');
if (!report.fullstack.auth?.reauthOnWebViewCrash) fail('auth reauth');
if (report.fullstack.network?.allowCleartext) fail('cleartext');

const wsReport = JSON.parse(ws.checkNativeFullstackContract());
if (wsReport.schema !== NATIVE_HOST_FULLSTACK_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

console.log('native gate: reject bridgeBypassesServer…');
const bypass = structuredClone(profile);
bypass.serverTransport.bridgeBypassesServer = true;
fs.writeFileSync(path.join(dir, 'native-fullstack.json'), JSON.stringify(bypass, null, 2));
const bypassFail = JSON.parse(checkNativeFullstackContractJson(dir));
if (bypassFail.status !== 'failed') fail('expected failed for bypass');
if (!(bypassFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER)) {
    fail(`expected ${NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER}`);
}

console.log('native gate: reject remote SSR without integrity…');
const remote = structuredClone(profile);
remote.ssr.mode = 'remote';
remote.ssr.integrity = '';
fs.writeFileSync(path.join(dir, 'native-fullstack.json'), JSON.stringify(remote, null, 2));
const remoteFail = JSON.parse(checkNativeFullstackContractJson(dir));
if (remoteFail.status !== 'failed') fail('expected failed for remote without integrity');
if (!(remoteFail.diagnostics || []).some((d) => d.code === NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY)) {
    fail(`expected ${NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY}`);
}

console.log('native gate: reject mixed SSR cookie assumptions…');
const mixed = structuredClone(profile);
mixed.ssr.mode = 'hybrid';
mixed.ssr.integrity = 'sha256:demo';
mixed.ssr.allowMixedCookieAssumptions = true;
fs.writeFileSync(path.join(dir, 'native-fullstack.json'), JSON.stringify(mixed, null, 2));
const mixedFail = JSON.parse(checkNativeFullstackContractJson(dir));
if (mixedFail.status !== 'failed') fail('expected failed for mixed cookies');
if (!(mixedFail.diagnostics || []).some((d) => d.code === 'vmz::native_host::mixed_ssr_cookie_assumptions')) {
    fail('expected mixed_ssr_cookie_assumptions');
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('native GATE OK: SSR first-paint + #server transport + auth/session + network + integrity + foul rejects');

/**
 * Mini tooling/deploy package + deterministic Mini Host.
 * verify id: miniprogram-tooling-deploy
 *
 * Proves deploy package layout, VMZ-owned host (event/patch/nav/server-stub),
 * and vendor-devtools handoff stays transport-only (not invoked in CI).
 * Not a WXML emitter; does not claim WeChat support without real tools.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMiniHost, createWorkspace, lowerMiniprogramToolingDeployJson } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-tooling-deploy FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-tooling-deploy: build counter + Link + #server…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-tool-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <button @click={increment}>{n}</button>
  <Link to="AboutPage">go</Link>
  <button @click={load}>{msg}</button>
</template>
<script client>
export default class IndexPage {
  n = 0;
  msg = '';
  increment() { this.n = this.n + 1; }
  async load() { this.msg = await this.hello(); }
}
</script>
<script server>
export default class IndexPage {
  hello() { return 'ok'; }
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'about.vmz'),
    `<template><p>about</p></template>
<script client>
export default class AboutPage {}
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
if ((built.diagnostics || []).some((d: { severity?: string }) => d.severity === 'error')) {
    fail(`build errors: ${JSON.stringify(built.diagnostics)}`);
}

console.log('miniprogram-tooling-deploy: lower deploy package…');
const report = JSON.parse(lowerMiniprogramToolingDeployJson(dir));
if (report.schema !== 'vmz.target.mini_tooling_deploy.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}

const pkg = report.package;
if (pkg.schema !== 'vmz.mini.deploy_package.v0') fail(`package schema ${pkg.schema}`);
if (pkg.platformId !== 'mini-program') fail(`platform ${pkg.platformId}`);
if (pkg.adapterId !== 'wechat-miniprogram') fail(`adapter ${pkg.adapterId}`);
if (pkg.host?.schema !== 'vmz.mini.host.v0') fail(`host ${JSON.stringify(pkg.host)}`);
if (pkg.host?.kind !== 'deterministic-interpreter') fail(`host kind ${pkg.host?.kind}`);
if (pkg.vendorTooling?.schema !== 'vmz.mini.vendor_tooling.v0') {
    fail(`vendorTooling ${JSON.stringify(pkg.vendorTooling)}`);
}
if (pkg.vendorTooling?.role !== 'transport-conformance') fail('vendor role');
if (pkg.vendorTooling?.invokedInCi !== false) fail('vendor must not run in CI');
if (pkg.vendorTooling?.requiredForSupportClaim !== true) fail('support claim gate');
if (pkg.devSession?.target !== 'mini-program-wechat') fail(`dev target ${pkg.devSession?.target}`);
if (pkg.constraints?.wxmlEmitter !== false) fail('wxmlEmitter must be false');
if (pkg.constraints?.wxssEmitter !== false) fail('wxssEmitter must be false');
if (pkg.constraints?.serverImplInMiniPackage !== false) fail('serverImpl must be false');
if (pkg.constraints?.independentBackend !== false) fail('independentBackend must be false');

const onDisk = path.join(dir, report.packagePath);
if (!fs.existsSync(onDisk)) fail(`missing package ${onDisk}`);
const harnessPath = path.join(dir, 'dist', '_vmz', 'mini-deploy', 'host-harness.json');
if (!fs.existsSync(harnessPath)) fail(`missing harness ${harnessPath}`);

if (!(pkg.pages || []).some((p: { routeId?: string }) => p.routeId === 'AboutPage')) {
    fail(`pages missing AboutPage: ${JSON.stringify(pkg.pages)}`);
}
if (!(pkg.serverCapabilities || []).some((c: { method?: string }) => c.method === 'hello')) {
    fail(`serverCapabilities missing hello: ${JSON.stringify(pkg.serverCapabilities)}`);
}

console.log('miniprogram-tooling-deploy: Mini Host event/nav/server-stub…');
const host = createMiniHost({
    package: pkg,
    loadArtifact(artifactPath: string) {
        const abs = path.join(dir, artifactPath);
        return JSON.parse(fs.readFileSync(abs, 'utf8'));
    },
});

const mounted = host.mount();
if (!String(mounted.chunkId || '').includes('pages/index')) {
    fail(`mount chunk ${mounted.chunkId}`);
}

const eventsPath = path.join(
    dir,
    (pkg.artifacts || []).find((a: { chunkId?: string }) => String(a.chunkId || '').includes('pages/index'))?.artifactPath || '',
);
const art = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const events = JSON.parse(art.eventTable);
const increment = (events.handlers || []).find((h: { method?: string }) => h.method === 'increment');
if (!increment?.handlerId) fail(`increment handler missing: ${JSON.stringify(events.handlers)}`);

const dispatched = host.dispatchEvent(increment.handlerId);
if (!dispatched.patchPaths?.length) fail(`no patchPaths: ${JSON.stringify(dispatched)}`);
const stateAfterClick = host.getState();
if (!stateAfterClick.appliedPatches.length) fail('appliedPatches empty');

const nav = host.navigate('AboutPage');
if (!String(nav.chunkId || '').includes('about')) fail(`nav chunk ${nav.chunkId}`);

const stub = host.callServerStub('hello');
if (stub.scheme !== '#server' || stub.bodyShipped !== false || stub.pending !== true) {
    fail(`server stub ${JSON.stringify(stub)}`);
}

const finalState = host.getState();
if (!finalState.navigations.includes('AboutPage')) fail('nav not recorded');
if (!finalState.serverCalls.some((c) => c.method === 'hello')) fail('server call not recorded');

const wsReport = JSON.parse(ws.lowerMiniprogramToolingDeploy());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(
    `miniprogram-tooling-deploy PASS: pages=${pkg.pages.length} caps=${pkg.serverCapabilities.length} patches=${finalState.appliedPatches.length}`,
);

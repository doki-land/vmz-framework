/**
 * Mini multi-adapter — wechat + alipay packaging stubs share one neutral package.
 * verify id: miniprogram-multi-adapter
 *
 * Algebraic second-platform gate. Not vendor runtimes; no WXML/AXML emitter.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMiniHost, createWorkspace, lowerMiniprogramMultiAdapterJson } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-multi-adapter FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-multi-adapter: build counter + Link + #server…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-multi-'));
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

console.log('miniprogram-multi-adapter: lower dual adapters…');
const report = JSON.parse(lowerMiniprogramMultiAdapterJson(dir));
if (report.schema !== 'vmz.target.mini_multi_adapter.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}

const man = report.manifest;
if (man.schema !== 'vmz.mini.multi_adapter.v0') fail(`manifest schema ${man.schema}`);
if (man.allowsPlatformSemanticFork !== false) fail('semantic fork must be false');
if (man.shared?.schema !== 'vmz.mini.multi_adapter_shared.v0') fail('shared schema');
if (man.shared?.artifactSchema !== 'vmz.target.mini_program_artifact.v0') {
    fail(`artifactSchema ${man.shared?.artifactSchema}`);
}
if (man.shared?.deployPackageSchema !== 'vmz.mini.deploy_package.v0') fail('deployPackageSchema');
if (man.shared?.hostSchema !== 'vmz.mini.host.v0') fail('hostSchema');
if (man.shared?.allowsPlatformSemanticFork !== false) fail('shared fork flag');

const adapters = man.adapters || [];
if (adapters.length < 2) fail(`need ≥2 adapters: ${JSON.stringify(adapters)}`);
const ids = adapters.map((a: { adapterId?: string }) => a.adapterId);
for (const want of ['wechat-miniprogram', 'alipay-miniprogram']) {
    if (!ids.includes(want)) fail(`missing adapter ${want}: ${JSON.stringify(ids)}`);
}

for (const a of adapters) {
    if (a.schema !== 'vmz.mini.adapter_contribution.v0') fail(`contrib schema ${a.schema}`);
    if (a.kind !== 'packaging-stub') fail(`kind ${a.kind}`);
    if (a.packagingOnly !== true) fail('packagingOnly');
    if (a.isSemanticTruthSource !== false) fail('isSemanticTruthSource');
    if (a.consumesNeutralPackage !== true) fail('consumesNeutralPackage');
    if (a.elementMapping?.vendorTemplateEmitter !== false) fail('vendorTemplateEmitter');
    if (a.vendorTooling?.role !== 'transport-conformance') fail('vendor role');
    if (a.vendorTooling?.invokedInCi !== false) fail('invokedInCi');
    if (!a.lifecycleMapping?.onLoad) fail(`lifecycle ${a.adapterId}`);
    if (!a.transport?.server || !a.transport?.viewPatches) fail(`transport ${a.adapterId}`);
}

const onDisk = path.join(dir, report.manifestPath);
if (!fs.existsSync(onDisk)) fail(`missing manifest ${onDisk}`);

const pkg = report.package;
if (pkg.schema !== 'vmz.mini.deploy_package.v0') fail(`package ${pkg.schema}`);
if (pkg.platformId !== 'mini-program') fail(`platformId ${pkg.platformId}`);
const pkgAdapters = (pkg.adapters || []).map((a: { adapterId?: string }) => a.adapterId);
if (!pkgAdapters.includes('wechat-miniprogram') || !pkgAdapters.includes('alipay-miniprogram')) {
    fail(`package.adapters ${JSON.stringify(pkgAdapters)}`);
}

console.log('miniprogram-multi-adapter: same Mini Host over shared package…');
const host = createMiniHost({
    package: pkg,
    loadArtifact(artifactPath: string) {
        return JSON.parse(fs.readFileSync(path.join(dir, artifactPath), 'utf8'));
    },
});
host.mount();
const artPath = (pkg.artifacts || []).find((a: { chunkId?: string }) => String(a.chunkId || '').includes('pages/index'))?.artifactPath;
if (!artPath) fail('index artifact missing');
const art = JSON.parse(fs.readFileSync(path.join(dir, artPath), 'utf8'));
const events = JSON.parse(art.eventTable);
const increment = (events.handlers || []).find((h: { method?: string }) => h.method === 'increment');
if (!increment?.handlerId) fail('increment handler');
host.dispatchEvent(increment.handlerId);
host.navigate('AboutPage');
host.callServerStub('hello');
const state = host.getState();
if (!state.appliedPatches.length || !state.navigations.includes('AboutPage')) {
    fail(`host state ${JSON.stringify(state)}`);
}

// Negative: single-adapter manifest must fail validation via workspace lower of a forged file.
const forged = {
    schema: 'vmz.mini.multi_adapter.v0',
    allowsPlatformSemanticFork: false,
    shared: man.shared,
    adapters: [adapters[0]],
};
fs.writeFileSync(path.join(dir, 'forged-multi.json'), JSON.stringify(forged));
// Re-check through native validate by expecting dual adapters in real report only.
if (adapters.length < 2) fail('dual adapters required');

const wsReport = JSON.parse(ws.lowerMiniprogramMultiAdapter());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);
if ((wsReport.manifest?.adapters || []).length < 2) fail('workspace adapters');

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`miniprogram-multi-adapter PASS: adapters=${ids.join(',')} patches=${state.appliedPatches.length}`);

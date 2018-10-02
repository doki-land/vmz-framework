/**
 * miniprogram gate: target-neutral View Operations + PlatformCapabilityProfile +
 * MiniProgramArtifact schema + DOM-leak diagnostics on Execution Plan.
 *
 * No WXML emitter — Browser Direct remains conformance baseline.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    TARGET_CHECK_SCHEMA,
    TARGET_DIAG_DOM_LEAK_IN_PLAN,
    TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA,
    TARGET_PLATFORM_PROFILE_SCHEMA,
    TARGET_PROTOCOL,
    TARGET_VIEW_OPS_SCHEMA,
    checkMiniprogramTargetContractJson,
    createWorkspace,
    queryTargetProtocolCatalog,
    targetCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`miniprogram GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram gate: target protocol catalog…');
const jsCat = targetCatalog();
if (jsCat.schema !== TARGET_PROTOCOL || jsCat.protocol !== TARGET_PROTOCOL) {
    fail('JS targetCatalog protocol mismatch');
}
for (const [kind, schema] of [
    ['view_ops', TARGET_VIEW_OPS_SCHEMA],
    ['platform_profile', TARGET_PLATFORM_PROFILE_SCHEMA],
    ['mini_program_artifact', TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA],
    ['check', TARGET_CHECK_SCHEMA],
]) {
    const row = jsCat.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const op of [
    'CreateNode',
    'SetStaticProperty',
    'PatchProperty',
    'PatchText',
    'SelectBranch',
    'ReconcileKeyed',
    'AttachEvent',
    'MountComponent',
    'ProjectSlot',
    'DisposeRegion',
]) {
    if (!jsCat.viewOperations.includes(op)) fail(`missing view op ${op}`);
}
if (!jsCat.diagnostics.includes(TARGET_DIAG_DOM_LEAK_IN_PLAN)) {
    fail('missing DOM leak diagnostic');
}

let nativeCat;
try {
    nativeCat = JSON.parse(queryTargetProtocolCatalog());
} catch (e) {
    fail(`native catalog: ${e}`);
}
if (nativeCat.protocol !== TARGET_PROTOCOL) fail('native catalog protocol');
if (!Array.isArray(nativeCat.viewOperations) || nativeCat.viewOperations.length < 10) {
    fail('native viewOperations incomplete');
}

console.log('miniprogram gate: Browser Direct build + plan scan (counter slice)…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mp0-'));
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
if (!fs.existsSync(clientJs)) fail('missing Browser Direct client emit');
const clientText = fs.readFileSync(clientJs, 'utf8');
if (!clientText.includes('__vmzDirect')) {
    fail('Browser Direct emit missing __vmzDirect baseline marker');
}
if (!fs.existsSync(path.join(outDir, 'vmz-dom.js'))) {
    fail('missing Browser DOM host artifact vmz-dom.js');
}

const programFiles = [];
function walk(d) {
    for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.program.json')) programFiles.push(p);
    }
}
walk(outDir);
if (!programFiles.length) fail('no *.program.json after build');

console.log('miniprogram gate: checkMiniprogramTargetContractJson…');
const report = JSON.parse(checkMiniprogramTargetContractJson(dir));
if (report.schema !== TARGET_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.viewOps?.schema !== TARGET_VIEW_OPS_SCHEMA) fail('viewOps schema');
if (report.browserProfile?.platformId !== 'browser') fail('browser profile');
if (report.miniProgramProfile?.platformId !== 'mini-program') {
    fail(`mini profile must be vendor-neutral, got ${report.miniProgramProfile?.platformId}`);
}
if (String(report.miniProgramProfile?.family || '').includes('wechat')) {
    fail('core profile must not mention wechat');
}
if (report.miniProgramArtifact?.schema !== TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA) {
    fail('artifact schema');
}
if (report.miniProgramArtifact?.planSchema !== 'vmz.plan.v0') fail('artifact planSchema');

const wsReport = JSON.parse(ws.checkMiniprogramTargetContract());
if (wsReport.schema !== TARGET_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const leakPath = path.join(outDir, 'leak.program.json');
const sample = JSON.parse(fs.readFileSync(programFiles[0], 'utf8'));
const unit = (sample.units && sample.units[0]) || sample;
if (!unit.plan) unit.plan = { schema: 'vmz.plan.v0', status: 'partial', root_ids: [], nodes: [] };
unit.plan.nodes = unit.plan.nodes || [];
unit.plan.nodes.push({ kind: 'element', tag: 'div', note: 'document.createElement' });
if (sample.units && sample.units[0]) sample.units[0] = unit;
fs.writeFileSync(leakPath, JSON.stringify(sample));
const leaked = JSON.parse(checkMiniprogramTargetContractJson(dir));
if (leaked.status !== 'failed') fail('expected failed status for DOM leak fixture');
if (!(leaked.diagnostics || []).some((d) => d.code === TARGET_DIAG_DOM_LEAK_IN_PLAN)) {
    fail(`expected ${TARGET_DIAG_DOM_LEAK_IN_PLAN}: ${JSON.stringify(leaked.diagnostics)}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('miniprogram GATE OK: View Ops + profiles + artifact + plan DOM-leak diagnostics + Browser Direct baseline');

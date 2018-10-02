/**
 * Mini TemplateSurface static slice — neutral template + logic initialData.
 * verify id: miniprogram-static-slice
 *
 * Author pages stay ordinary `.vmz`. Pack/adapter do not invent a Mini IR.
 * This gate proves Plan/View → MiniProgramArtifact (template + logic) for a
 * hello/counter-shaped page. Not a WeChat WXML emitter.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, lowerMiniprogramStaticSliceJson, TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-static-slice FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-static-slice: build hello/counter page…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-static-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <p>hello</p>
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
if ((built.diagnostics || []).some((d: { severity?: string }) => d.severity === 'error')) {
    fail(`build errors: ${JSON.stringify(built.diagnostics)}`);
}

console.log('miniprogram-static-slice: lowerMiniprogramStaticSliceJson…');
const report = JSON.parse(lowerMiniprogramStaticSliceJson(dir));
if (report.schema !== 'vmz.target.mini_static_slice.v0') {
    fail(`report schema ${report.schema}`);
}
if (report.dialect !== 'vmz.mini.template.v0') fail(`dialect ${report.dialect}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}
if (!Array.isArray(report.artifacts) || report.artifacts.length < 1) {
    fail(`expected ≥1 page artifact: ${JSON.stringify(report)}`);
}

const page =
    report.artifacts.find((a: { chunkId?: string }) => a.chunkId === 'pages/index' || String(a.chunkId || '').includes('index')) ||
    report.artifacts[0];
const art = page.artifact;
if (art.schema !== TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA) fail(`artifact schema ${art.schema}`);
if (art.platformId !== 'mini-program') fail(`platform must stay vendor-neutral: ${art.platformId}`);
if (!art.template || !art.template.includes('hello')) fail(`template missing hello: ${art.template}`);
if (!art.template.includes('{{b.B_')) fail(`template missing binding path: ${art.template}`);
if (art.template.includes('wx:') || art.template.includes('wxml')) {
    fail(`must not emit WeChat-specific template dialect: ${art.template}`);
}
if (!art.logic || !art.logic.includes('vmz.mini.logic.v0')) fail(`logic schema missing: ${art.logic}`);
if (!art.logic.includes('"b"') || !art.logic.includes('B_')) fail(`logic initialData missing: ${art.logic}`);
if (art.eventTable) fail('static slice must not invent event_table yet');

const onDisk = path.join(dir, page.artifactPath);
if (!fs.existsSync(onDisk)) fail(`missing written artifact ${onDisk}`);

const wsReport = JSON.parse(ws.lowerMiniprogramStaticSlice());
if (wsReport.status !== 'ready' || !(wsReport.artifacts || []).length) {
    fail(`workspace lower ${wsReport.status}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`miniprogram-static-slice PASS: artifacts=${report.artifacts.length} dialect=${report.dialect}`);

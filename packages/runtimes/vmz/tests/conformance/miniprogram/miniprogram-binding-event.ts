/**
 * Mini BindingId patch + event table — counter slice.
 * verify id: miniprogram-binding-event
 *
 * Proves Reactive effect writes → affected BindingIds → patchPaths,
 * and `@click` → stable `data-vmz-on` + event_table (no WeChat API).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, lowerMiniprogramBindingEventJson, TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-binding-event FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-binding-event: build counter page…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-bind-'));
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
if ((built.diagnostics || []).some((d: { severity?: string }) => d.severity === 'error')) {
    fail(`build errors: ${JSON.stringify(built.diagnostics)}`);
}

console.log('miniprogram-binding-event: lowerMiniprogramBindingEventJson…');
const report = JSON.parse(lowerMiniprogramBindingEventJson(dir));
if (report.schema !== 'vmz.target.mini_binding_event.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}
if (!report.artifacts?.length) fail(`no artifacts: ${JSON.stringify(report)}`);

const art = report.artifacts[0].artifact;
if (art.schema !== TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA) fail(`artifact schema ${art.schema}`);
if (art.platformId !== 'mini-program') fail(`platform ${art.platformId}`);
if (!art.template?.includes('data-vmz-on="h0"')) fail(`template missing handler: ${art.template}`);
if (!art.template?.includes('{{b.B_')) fail(`template missing binding path: ${art.template}`);
if (art.template.includes('@click') || art.template.includes('wx.')) {
    fail(`must stay vendor-neutral: ${art.template}`);
}

const events = JSON.parse(art.eventTable);
if (events.schema !== 'vmz.mini.event_table.v0') fail(`event schema ${events.schema}`);
const h0 = events.handlers?.[0];
if (!h0 || h0.handlerId !== 'h0' || h0.method !== 'increment' || h0.eventKind !== 'click') {
    fail(`handler row: ${JSON.stringify(h0)}`);
}
if (!h0.affectedBindings?.length || !h0.patchPaths?.some((p: string) => p.startsWith('b.B_'))) {
    fail(`affected/patch missing: ${JSON.stringify(h0)}`);
}

const patch = JSON.parse(art.dataPatchTable);
if (patch.schema !== 'vmz.mini.data_patch_table.v0') fail(`patch schema ${patch.schema}`);
if (!patch.bindings?.some((b: { dataPath?: string }) => String(b.dataPath || '').startsWith('b.B_'))) {
    fail(`data_patch bindings: ${JSON.stringify(patch.bindings)}`);
}
if (!patch.fields?.some((f: { affects?: number[] }) => (f.affects || []).length > 0)) {
    fail(`data_patch fields: ${JSON.stringify(patch.fields)}`);
}

const onDisk = path.join(dir, report.artifacts[0].artifactPath);
if (!fs.existsSync(onDisk)) fail(`missing ${onDisk}`);

const wsReport = JSON.parse(ws.lowerMiniprogramBindingEvent());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`miniprogram-binding-event PASS: handlers=${events.handlers.length} patchBindings=${patch.bindings.length}`);

/**
 * Mini structure + lifecycle/dispose — if / keyed each / component / slot.
 * verify id: miniprogram-structure
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, lowerMiniprogramStructureJson, TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-structure FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-structure: build structured page…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-struct-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Badge.vmz'),
    `<template><span>{label}</span></template>
<script client>
export default class Badge {
  public label = '';
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <li each={items} as="it" key={it.id}>{it.name}</li>
  <Badge label={title} />
  <div if={show}>hi</div>
</template>
<script client>
import Badge from '../components/Badge.vmz';
export default class IndexPage {
  title = 't';
  show = true;
  items = [{ id: 1, name: 'a' }];
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

console.log('miniprogram-structure: lowerMiniprogramStructureJson…');
const report = JSON.parse(lowerMiniprogramStructureJson(dir));
if (report.schema !== 'vmz.target.mini_structure.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}
if ((report.artifacts || []).length < 2) {
    fail(`expected page+app artifacts, got ${JSON.stringify(report.artifacts?.map((a: { chunkId: string }) => a.chunkId))}`);
}

const page = report.artifacts.find((a: { chunkId?: string }) => String(a.chunkId || '').includes('pages/'));
const app = report.artifacts.find((a: { chunkId?: string }) => a.chunkId === 'Application');
if (!page?.artifact) fail('missing page artifact');
if (!app?.artifact) fail('missing Application artifact');

const art = page.artifact;
if (art.schema !== TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA) fail(`artifact schema ${art.schema}`);
if (art.platformId !== 'mini-program') fail(`platform ${art.platformId}`);
if (!art.template?.includes('data-vmz-each=')) fail(`each missing: ${art.template}`);
if (!art.template?.includes('data-vmz-as=')) fail(`as missing: ${art.template}`);
if (!art.template?.includes('<vmz-component name="Badge"')) fail(`component missing: ${art.template}`);
if (!art.template?.includes('data-vmz-if=')) fail(`if missing: ${art.template}`);
if (art.template.includes('wx:') || art.template.includes('wx.')) {
    fail(`must stay vendor-neutral: ${art.template}`);
}

const life = JSON.parse(art.manifest);
if (life.schema !== 'vmz.mini.lifecycle_table.v0') fail(`lifecycle schema ${life.schema}`);
if (life.pageHooks?.onUnload !== 'dispose') fail(`pageHooks: ${JSON.stringify(life.pageHooks)}`);
if (!life.regions?.some((r: { kind?: string }) => r.kind === 'each')) {
    fail(`regions missing each: ${JSON.stringify(life.regions)}`);
}
if (!life.dispose?.some((d: { source?: string }) => d.source === 'if' || d.source === 'each')) {
    fail(`dispose missing: ${JSON.stringify(life.dispose)}`);
}

if (!app.artifact.template?.includes('<slot')) {
    fail(`Application slot missing: ${app.artifact.template}`);
}

const wsReport = JSON.parse(ws.lowerMiniprogramStructure());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`miniprogram-structure PASS: artifacts=${report.artifacts.length} regions=${life.regions.length} dispose=${life.dispose.length}`);

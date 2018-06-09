/**
 * Mini Route / `#server` / Canonical Style thin gate.
 * verify id: miniprogram-route-server-style
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, lowerMiniprogramRouteServerStyleJson, TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-route-server-style FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-route-server-style: build Link + #server + style:tw…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-rss-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <Link to="AboutPage">go</Link>
  <p class="hello" style:tw="text-sm">{n}</p>
  <button @click={load}>{msg}</button>
</template>
<script client>
export default class IndexPage {
  n = 0;
  msg = '';
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

console.log('miniprogram-route-server-style: lower…');
const report = JSON.parse(lowerMiniprogramRouteServerStyleJson(dir));
if (report.schema !== 'vmz.target.mini_route_server_style.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}

const pages = (report.routeTable?.pages || []) as Array<{ routeId?: string; chunkId?: string }>;
if (!pages.some((p) => p.routeId === 'IndexPage' || String(p.chunkId || '').includes('pages/index'))) {
    fail(`route table missing IndexPage: ${JSON.stringify(pages)}`);
}
if (!pages.some((p) => p.routeId === 'AboutPage' || String(p.chunkId || '').includes('about'))) {
    fail(`route table missing AboutPage: ${JSON.stringify(pages)}`);
}

const page = report.artifacts.find((a: { chunkId?: string }) => String(a.chunkId || '').includes('pages/index'));
if (!page?.artifact) fail(`missing index artifact: ${JSON.stringify(report.artifacts?.map((a: { chunkId: string }) => a.chunkId))}`);

const art = page.artifact;
if (art.schema !== TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA) fail(`artifact schema ${art.schema}`);
if (art.platformId !== 'mini-program') fail(`platform ${art.platformId}`);

const style = JSON.parse(art.style);
if (style.schema !== 'vmz.mini.canonical_style.v0') fail(`style schema ${style.schema}`);
if (style.wxss !== false) fail('must not claim wxss');
if (!style.classTokens?.includes('hello') && !style.classTokens?.includes('text-sm')) {
    fail(`classTokens missing hello/text-sm: ${JSON.stringify(style.classTokens)}`);
}

const man = JSON.parse(art.manifest);
if (man.schema !== 'vmz.mini.mp4_manifest.v0') fail(`manifest schema ${man.schema}`);
if (man.lifecycle?.schema !== 'vmz.mini.lifecycle_table.v0') {
    fail(`lifecycle preserved? ${JSON.stringify(man.lifecycle?.schema)}`);
}
const links = man.routes?.links || [];
if (!links.some((l: { routeId?: string }) => l.routeId === 'AboutPage')) {
    fail(`Link AboutPage missing: ${JSON.stringify(links)}`);
}
const caps = man.serverTransport?.capabilities || [];
if (!caps.some((c: { method?: string }) => c.method === 'hello')) {
    fail(`#server hello missing: ${JSON.stringify(caps)}`);
}
if (man.serverTransport?.implInMiniPackage !== false) {
    fail('server impl must not ship in mini package');
}
if (man.serverTransport?.scheme !== '#server') fail(`scheme ${man.serverTransport?.scheme}`);

if (art.template?.includes('wx:') || art.template?.includes('wxss')) {
    fail(`vendor leak: ${art.template}`);
}

const wsReport = JSON.parse(ws.lowerMiniprogramRouteServerStyle());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(
    `miniprogram-route-server-style PASS: pages=${pages.length} links=${links.length} caps=${caps.length} tokens=${style.classTokens.length}`,
);

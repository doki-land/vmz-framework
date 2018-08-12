/**
 * WeChat packaging files from `.vmz` via vmz-generator.
 * verify id: miniprogram-wechat-pack
 *
 * Compiler orchestrates emit_wechat_wxml / print_wxss. WXML is not authoring
 * truth; adapters must not own this printer. Not a WeChat support claim.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, lowerMiniprogramWechatPackagingJson } from 'vmz';

function fail(msg: string): never {
    console.error(`miniprogram-wechat-pack FAIL: ${msg}`);
    process.exit(1);
}

console.log('miniprogram-wechat-pack: build rewrite-mini home-shaped page…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-mini-wechat-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <div class="page">
    <div class="loc" @click={onStore}>{store}</div>
    <div class="deal" each={deals} as="item" key={item.id}>{item.title}</div>
  </div>
</template>
<style>
.page { padding: 24rpx; color: #3d6b2f; }
</style>
<script client>
export default class IndexPage {
  store = 'Waitrose';
  deals = [{ id: 'd1', title: 'deal' }];
  onStore() { this.store = 'Waitrose 静安店'; }
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

console.log('miniprogram-wechat-pack: lower WeChat packaging…');
const report = JSON.parse(lowerMiniprogramWechatPackagingJson(dir));
if (report.schema !== 'vmz.target.mini_wechat_pack.v0') fail(`schema ${report.schema}`);
if (report.status !== 'ready') {
    fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
}
if (report.printer !== 'vmz-generator') fail(`printer ${report.printer}`);
if (report.packRoot !== 'dist/wechat') fail(`packRoot ${report.packRoot}`);

const pack = path.join(dir, 'dist', 'wechat');
const wxmlPath = path.join(pack, 'pages', 'index', 'index.wxml');
const wxssPath = path.join(pack, 'pages', 'index', 'index.wxss');
const pageJsPath = path.join(pack, 'pages', 'index', 'index.js');
const appJsonPath = path.join(pack, 'app.json');
const appJsPath = path.join(pack, 'app.js');
const projectPath = path.join(pack, 'project.config.json');
if (!fs.existsSync(wxmlPath)) fail(`missing ${wxmlPath}`);
if (!fs.existsSync(wxssPath)) fail(`missing ${wxssPath}`);
if (!fs.existsSync(pageJsPath)) fail(`missing ${pageJsPath}`);
if (!fs.existsSync(appJsonPath)) fail(`missing ${appJsonPath}`);
if (!fs.existsSync(appJsPath)) fail(`missing ${appJsPath}`);
if (!fs.existsSync(projectPath)) fail(`missing ${projectPath}`);

const wxml = fs.readFileSync(wxmlPath, 'utf8');
if (!wxml.includes('<view class="page">')) fail(`page view missing: ${wxml}`);
if (!wxml.includes('bindtap="onStore"')) fail(`bindtap missing: ${wxml}`);
if (!wxml.includes('wx:for=')) fail(`wx:for missing: ${wxml}`);
if (wxml.includes('@click')) fail(`author event leaked: ${wxml}`);

const wxss = fs.readFileSync(wxssPath, 'utf8');
if (!wxss.includes('24rpx')) fail(`rpx missing: ${wxss}`);

const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
if (!(app.pages || []).includes('pages/index/index')) {
    fail(`app.json pages ${JSON.stringify(app.pages)}`);
}
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
if (project.compileType !== 'miniprogram') fail(`compileType ${project.compileType}`);
if (project.miniprogramRoot !== './') fail(`miniprogramRoot ${project.miniprogramRoot}`);
if (!fs.readFileSync(appJsPath, 'utf8').includes('App(')) fail('app.js missing App()');
if (!fs.readFileSync(pageJsPath, 'utf8').includes('Page(')) fail('page js missing Page()');

const wsReport = JSON.parse(ws.lowerMiniprogramWechatPackaging());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('miniprogram-wechat-pack PASS: dist/wechat DevTools project via vmz-generator');

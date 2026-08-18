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
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
const tabSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="currentColor"/></svg>';
fs.writeFileSync(path.join(dir, 'assets', 'tab-home.svg'), tabSvg);
fs.writeFileSync(path.join(dir, 'assets', 'tab-me.svg'), tabSvg);
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<router>
{
  tab: { order: 0, label: "首页", icon: "assets/tab-home.svg" },
}
</router>
<template>
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
    path.join(dir, 'src', 'pages', 'me.vmz'),
    `<router>
{
  tab: { order: 1, label: "我的", icon: "assets/tab-me.svg" },
}
</router>
<template>
  <div class="page">me</div>
</template>
<style>
.me-only { color: #c00; }
</style>
<script client>
export default class MePage {}
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
if (wxss.includes('me-only')) fail(`index wxss leaked me-only: ${wxss}`);
const meWxss = fs.readFileSync(path.join(pack, 'pages', 'me', 'me.wxss'), 'utf8');
if (!meWxss.includes('me-only')) fail(`me wxss missing me-only: ${meWxss}`);
if (meWxss.includes('24rpx')) fail(`me wxss leaked index padding: ${meWxss}`);

const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
if (!(app.pages || []).includes('pages/index/index')) {
    fail(`app.json pages ${JSON.stringify(app.pages)}`);
}
if (app.window?.navigationBarBackgroundColor !== '#3D6B2F') {
    fail(`nav bg ${app.window?.navigationBarBackgroundColor}`);
}
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
if (project.compileType !== 'miniprogram') fail(`compileType ${project.compileType}`);
if (project.miniprogramRoot !== './') fail(`miniprogramRoot ${project.miniprogramRoot}`);
if (project.appid !== 'touristappid') fail(`default appid ${project.appid}`);
if (!fs.readFileSync(appJsPath, 'utf8').includes('App(')) fail('app.js missing App()');
if (!fs.readFileSync(pageJsPath, 'utf8').includes('onShareAppMessage')) {
    fail('page js missing onShareAppMessage');
}
const pageJson = JSON.parse(fs.readFileSync(path.join(pack, 'pages', 'index', 'index.json'), 'utf8'));
if (pageJson.enableShareAppMessage !== true) {
    fail(`enableShareAppMessage ${pageJson.enableShareAppMessage}`);
}
if (app.tabBar?.custom === true) fail('native tabBar must not set custom');
if (!Array.isArray(app.tabBar?.list) || app.tabBar.list.length !== 2) {
    fail(`tabBar.list ${JSON.stringify(app.tabBar)}`);
}
if (app.tabBar.list[0]?.text !== '首页' || app.tabBar.list[0]?.iconPath !== 'assets/tab-home.png') {
    fail(`tab 0 ${JSON.stringify(app.tabBar.list[0])}`);
}
const tabPng = path.join(pack, 'assets', 'tab-home.png');
const tabOn = path.join(pack, 'assets', 'tab-home-on.png');
if (!fs.existsSync(tabPng) || !fs.existsSync(tabOn)) fail('tab png missing');
const pngHead = fs.readFileSync(tabPng).subarray(0, 4);
if (pngHead[0] !== 0x89 || pngHead[1] !== 0x50 || pngHead[2] !== 0x4e || pngHead[3] !== 0x47) {
    fail('tab-home.png is not PNG');
}

const wsReport = JSON.parse(ws.lowerMiniprogramWechatPackaging());
if (wsReport.status !== 'ready') fail(`workspace lower ${wsReport.status}`);

fs.writeFileSync(
    path.join(dir, 'vmz.config.ts'),
    `export default {
  delivery: {
    packaging: {
      wechat: { appId: 'wx47094018073f0644', projectName: 'waitrose-vmz-shell', title: 'Waitrose' },
    },
  },
};
`,
);
const configured = JSON.parse(lowerMiniprogramWechatPackagingJson(dir));
if (configured.status !== 'ready') fail(`configured pack ${configured.status}`);
const project2 = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
if (project2.appid !== 'wx47094018073f0644') fail(`configured appid ${project2.appid}`);
if (project2.projectname !== 'waitrose-vmz-shell') fail(`configured projectname ${project2.projectname}`);
const app2 = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
if (app2.window?.navigationBarTitleText !== 'Waitrose') {
    fail(`configured title ${app2.window?.navigationBarTitleText}`);
}
const pageJs2 = fs.readFileSync(pageJsPath, 'utf8');
if (!pageJs2.includes('Waitrose')) fail(`configured share title ${pageJs2}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('miniprogram-wechat-pack PASS: dist/wechat DevTools project via vmz-generator');

/**
 * document-integrated-layout gate (VMZ-11):
 * - integrated mount uses compiled DocumentLayout SSR (no regex template lowering)
 * - homepage /d/* HTML includes compiled SiteHeader/SiteFooter fixtures
 * - no {binding} leaks or raw Link/Button/Icon tags
 */

import fs from 'node:fs';
import path from 'node:path';
import { runVmzBuild } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const HOMEPAGE = 'packages/homepage';

function fail(msg: string): never {
    console.error(`document-integrated-layout GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('document-integrated-layout: forbid regex chrome lowering…');
const buildSrc = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/document-build.ts'), 'utf8');
const layoutSrc = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/document-layout-render.ts'), 'utf8');
for (const bad of ['renderHostChromeTemplate', 'extractVmzTemplateHtml', 'document-host-chrome']) {
    if (buildSrc.includes(bad)) fail(`document-build must not reference ${bad}`);
}
if (fs.existsSync(path.join(root, 'packages/runtimes/vmz/src/document-host-chrome.ts'))) {
    fail('document-host-chrome.ts must be removed (regex chrome deprecated)');
}
if (!layoutSrc.includes('createRenderHost')) fail('document-layout-render must use createRenderHost');

const layoutVmz = path.join(root, HOMEPAGE, 'src/layouts/DocumentLayout.vmz');
if (!fs.existsSync(layoutVmz)) fail('homepage missing src/layouts/DocumentLayout.vmz');
const layoutText = fs.readFileSync(layoutVmz, 'utf8');
for (const tag of ['SiteHeader', 'SiteFooter', '<slot']) {
    if (!layoutText.includes(tag)) fail(`DocumentLayout.vmz must include ${tag}`);
}

console.log('document-integrated-layout: build homepage + integrated /d…');
const homeBuild = runVmzBuild(HOMEPAGE, root);
if (homeBuild.status !== 0) {
    fail(`homepage build failed\n${homeBuild.stdout}\n${homeBuild.stderr}`);
}
const dist = homeBuild.dist;
const layoutClient = path.join(dist, 'layouts/DocumentLayout.client.js');
if (!fs.existsSync(layoutClient)) fail('homepage dist missing layouts/DocumentLayout.client.js');

const manifestPath = path.join(dist, 'document.manifest.json');
if (!fs.existsSync(manifestPath)) fail('homepage dist missing document.manifest.json after integrated build');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.build?.hostShell !== 'compiled-layout') {
    fail(`expected hostShell compiled-layout, got ${JSON.stringify(manifest.build?.hostShell)}`);
}

const docIndexCandidates = [path.join(dist, 'd/zh-hans/index.html'), path.join(dist, 'd/en-us/index.html')];
const docIndex = docIndexCandidates.find((p) => fs.existsSync(p));
if (!docIndex) fail('missing integrated document HTML under dist/d/<locale>/index.html');

const html = fs.readFileSync(docIndex, 'utf8');
if (!html.includes('data-vmz-fixture="site-header"') || !html.includes('data-vmz-fixture="site-footer"')) {
    fail('integrated document HTML missing compiled SiteHeader/SiteFooter markers');
}
const header = html.match(/<header[^>]*data-vmz-fixture="site-header"[\s\S]*?<\/header>/i)?.[0] ?? '';
const footer = html.match(/<footer[^>]*data-vmz-fixture="site-footer"[\s\S]*?<\/footer>/i)?.[0] ?? '';
for (const part of [header, footer]) {
    if (/\{[A-Za-z][A-Za-z0-9]*\}/.test(part)) fail('integrated document chrome leaked binding placeholder');
    if (/<(?:Link|Button|Icon)\b/.test(part)) fail('integrated document chrome leaked uncompiled VMZ tag');
}
if (!html.includes('class="site site--docs"')) fail('integrated document HTML missing DocumentLayout shell');
if (!html.includes('aria-label="Documents"')) fail('integrated document HTML missing doc subnav');
if (/<script[\s>]/i.test(html)) fail('integrated document index must remain no-script readable (island-only)');

console.log('document-integrated-layout GATE OK');
console.log(' compiled DocumentLayout · no regex chrome · /d host shell SSR');

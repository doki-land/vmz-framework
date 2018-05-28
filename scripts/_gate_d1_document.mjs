/**
 * D1 document static gate (normative):
 * - @vmz/plugin-markdown-it/runtime.ts via host importMaybeTs
 * - vmz document build → HTML + vmz.document.view.v0
 * - nav / link / anchor · /designs · no-JS readable
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { importMaybeTs } from '../packages/runtimes/vmz/dist/plugin-host.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'packages', 'examples', 'documents-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`D1 GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log('D1: load plugin runtime.ts via importMaybeTs…');
try {
    const fromVmz = createRequire(path.join(root, 'packages', 'runtimes', 'vmz', 'package.json'));
    let runtimeTs;
    try {
        const pkg = fromVmz.resolve('@vmz/plugin-markdown-it/package.json');
        runtimeTs = path.join(path.dirname(pkg), 'runtime.ts');
    } catch {
        runtimeTs = path.join(root, 'packages', 'plugins', 'vmz-plugin-markdown-it', 'runtime.ts');
    }
    const mod = await importMaybeTs(runtimeTs);
    const sample = mod.analyzeMarkdown('# Hello\n\n[x](./guide/install.md)\n');
    if (!sample.html.includes('<h1') || !sample.headings.some((h) => h.id)) {
        fail(`markdown analyze missing heading id: ${JSON.stringify(sample)}`);
    }
} catch (e) {
    fail(`markdown-it runtime.ts load: ${e.message || e}`);
}

console.log('D1: document build fixture…');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d1-'));
const build = runVmz(['document', 'build', fixture, '--out', outDir, '--strict']);
if (build.status !== 0) {
    fail(`build failed\n${build.stdout}\n${build.stderr}`);
}

const manifestPath = path.join(outDir, 'document.manifest.json');
if (!fs.existsSync(manifestPath)) fail('missing document.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.build?.designsCss) fail('expected designs CSS in build manifest');
const cssPath = path.join(outDir, manifest.build.designsCss);
if (!fs.existsSync(cssPath)) fail(`missing designs css at ${cssPath}`);

const zhIndex = path.join(outDir, 'docs', 'zh-hans', 'index.html');
const zhInstall = path.join(outDir, 'docs', 'zh-hans', 'guide', 'install.html');
if (!fs.existsSync(zhIndex)) fail(`missing ${zhIndex}`);
if (!fs.existsSync(zhInstall)) fail(`missing ${zhInstall}`);

const html = fs.readFileSync(zhIndex, 'utf8');
if (/<script[\s>]/i.test(html)) fail('no-JS gate: index.html must not require <script>');
if (!/<nav[^>]*aria-label="Documents"/i.test(html)) fail('missing Documents nav landmark');
if (!/<main\b/i.test(html)) fail('missing main landmark');
if (!html.includes('欢迎阅读') && !html.includes('VMZ')) fail('body content missing');
if (!html.includes('vmz-designs.css')) fail('designs stylesheet not linked');

const viewPath = path.join(outDir, 'views', 'zh-hans', 'index.view.json');
if (!fs.existsSync(viewPath)) fail(`missing view fragment ${viewPath}`);
const view = JSON.parse(fs.readFileSync(viewPath, 'utf8'));
if (view.schema !== 'vmz.document.view.v0') fail(`view schema ${view.schema}`);
if (!view.noJsReadable) fail('view.noJsReadable must be true');
if (!Array.isArray(view.nav) || view.nav.length < 2) fail('view.nav incomplete');

const installHtml = fs.readFileSync(zhInstall, 'utf8');
if (!/id="requirements"/i.test(installHtml)) {
    fail(`install page missing requirements anchor`);
}

console.log('D1: broken link must fail check…');
const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d1-bad-'));
const badDocs = path.join(badDir, 'documents');
fs.mkdirSync(path.join(badDocs, 'zh-hans'), { recursive: true });
fs.writeFileSync(path.join(badDocs, 'zh-hans', 'index.md'), '# Hi\n\n[nope](missing.md)\n');
fs.writeFileSync(
    path.join(badDocs, 'documents.config.json'),
    JSON.stringify({ defaultLocale: 'zh-hans', locales: { 'zh-hans': { label: 'z' } } }),
);
const bad = runVmz(['document', 'check', badDir, '--strict']);
if (bad.status === 0) fail('broken link should fail check');
if (!`${bad.stdout}\n${bad.stderr}`.includes('document::link::broken')) {
    fail(`want link::broken\n${bad.stdout}\n${bad.stderr}`);
}

console.log('D1 GATE PASS');
console.log('  runtime.ts · build HTML/view · designs · nav/anchors · no-JS readable');

/**
 * D0 document contract gate:
 * - valid locale-first tree + PageKey coverage
 * - reject zh-CN / zh-hans conflict
 * - reject illegal top-level guide/
 * - --strict missing translation fails
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'packages', 'examples', 'documents-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`D0-DOCUMENT GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args, cwd = root) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log('D0-document: valid fixture --strict --json…');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d0-'));
const manifestPath = path.join(tmp, 'manifest.json');
const ok = runVmz(['document', 'check', fixture, '--strict', '--json', manifestPath]);
if (ok.status !== 0) {
    fail(`valid fixture failed\n${ok.stdout}\n${ok.stderr}`);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 'vmz.document.manifest.v0') {
    fail(`schema want vmz.document.manifest.v0, got ${manifest.schema}`);
}
const keys = new Set(manifest.pages.map((p) => `${p.identity.locale}:${p.identity.pageKey}`));
for (const want of ['zh-hans:index', 'zh-hans:guide/install', 'en-us:index', 'en-us:guide/install']) {
    if (!keys.has(want)) fail(`missing PageIdentity ${want}; have ${[...keys]}`);
}
if (manifest.defaultLocale !== 'zh-hans') fail(`defaultLocale want zh-hans`);

console.log('D0-document: alias conflict zh-cn + zh-hans…');
const conflictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d0-conflict-'));
const conflictDocs = path.join(conflictDir, 'documents');
fs.mkdirSync(path.join(conflictDocs, 'zh-hans'), { recursive: true });
fs.mkdirSync(path.join(conflictDocs, 'zh-cn'), { recursive: true });
fs.writeFileSync(path.join(conflictDocs, 'zh-hans', 'index.md'), '# a\n');
fs.writeFileSync(path.join(conflictDocs, 'zh-cn', 'index.md'), '# b\n');
fs.writeFileSync(
    path.join(conflictDocs, 'documents.config.json'),
    JSON.stringify({
        defaultLocale: 'zh-hans',
        locales: { 'zh-hans': { label: '简体' }, 'zh-cn': { label: 'CN' } },
    }),
);
const cPath = path.join(tmp, 'conflict.json');
const conflict = runVmz(['document', 'check', conflictDir, '--json', cPath]);
if (conflict.status === 0) fail('alias conflict should fail');
const cm = JSON.parse(fs.readFileSync(cPath, 'utf8'));
if (!cm.diagnostics.some((d) => d.code === 'document::locale::conflict')) {
    fail(`want locale::conflict, got ${JSON.stringify(cm.diagnostics)}`);
}

console.log('D0-document: illegal top-level guide/…');
const illegalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d0-illegal-'));
const illegalDocs = path.join(illegalDir, 'documents');
fs.mkdirSync(path.join(illegalDocs, 'guide'), { recursive: true });
fs.writeFileSync(path.join(illegalDocs, 'guide', 'x.md'), '# x\n');
fs.writeFileSync(
    path.join(illegalDocs, 'documents.config.json'),
    JSON.stringify({ defaultLocale: 'zh-hans', locales: { 'zh-hans': { label: 'z' } } }),
);
const illPath = path.join(tmp, 'illegal.json');
const illegal = runVmz(['document', 'check', illegalDir, '--json', illPath]);
if (illegal.status === 0) fail('illegal top-level should fail');
const ill = JSON.parse(fs.readFileSync(illPath, 'utf8'));
if (!ill.diagnostics.some((d) => d.code === 'document::locale::invalid' || d.code === 'document::layout::illegal_top')) {
    // guide/ fails locale validation (not a valid locale) → invalid
    if (!ill.diagnostics.some((d) => String(d.code).startsWith('document::locale::'))) {
        fail(`want locale/layout diagnostic, got ${JSON.stringify(ill.diagnostics)}`);
    }
}

console.log('D0-document: --strict missing translation…');
const missDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d0-miss-'));
const missDocs = path.join(missDir, 'documents');
fs.mkdirSync(path.join(missDocs, 'zh-hans', 'guide'), { recursive: true });
fs.mkdirSync(path.join(missDocs, 'en-us'), { recursive: true });
fs.writeFileSync(path.join(missDocs, 'zh-hans', 'index.md'), '# z\n');
fs.writeFileSync(path.join(missDocs, 'zh-hans', 'guide', 'install.md'), '# i\n');
fs.writeFileSync(path.join(missDocs, 'en-us', 'index.md'), '# e\n');
fs.writeFileSync(
    path.join(missDocs, 'documents.config.json'),
    JSON.stringify({
        defaultLocale: 'zh-hans',
        locales: { 'zh-hans': { label: 'z' }, 'en-us': { label: 'e' } },
    }),
);
const missPath = path.join(tmp, 'miss.json');
const miss = runVmz(['document', 'check', missDir, '--strict', '--json', missPath]);
if (miss.status === 0) fail('missing translation under --strict should fail');
const mm = JSON.parse(fs.readFileSync(missPath, 'utf8'));
if (!mm.diagnostics.some((d) => d.code === 'document::locale::missing_page')) {
    fail(`want missing_page, got ${JSON.stringify(mm.diagnostics)}`);
}

console.log('D0-document: docs alias…');
const alias = runVmz(['docs', 'check', fixture, '--strict']);
if (alias.status !== 0) fail(`docs alias failed\n${alias.stdout}\n${alias.stderr}`);

console.log('D0-DOCUMENT GATE PASS');
console.log('  locale-first + PageKey + conflict/illegal/strict coverage');

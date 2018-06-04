/**
 * locale directory contract gate:
 * - locales.json5 + LocaleId dirs
 * - reject zh_CN / en-US
 * - reject fallback cycles / unknown edges
 * - MessageId from catalog path + keys
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { LOCALE_MANIFEST_SCHEMA, LOCALE_PROTOCOL, localeCatalog } from 'vmz';

const root = repoRoot(import.meta.url);
const fixture = path.join(root, 'packages', 'examples', 'locales-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args, cwd = root) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log(': protocol catalog freezes locale schemas…');
const cat = localeCatalog();
if (cat.protocol !== LOCALE_PROTOCOL) fail('JS locale catalog protocol');
if (!cat.documents.some((d) => d.kind === 'manifest' && d.schema === LOCALE_MANIFEST_SCHEMA)) {
    fail('missing manifest document');
}
if (cat.virtualModulePrefix !== '#locales/') fail('virtualModulePrefix');

console.log(': fixture locale check…');
const check = runVmz(['locale', 'check', fixture, '--json']);
if (check.status !== 0) fail(`fixture check failed\n${check.stdout}\n${check.stderr}`);
let report;
try {
    report = JSON.parse(check.stdout);
} catch (e) {
    fail(`not JSON: ${e}\n${check.stdout}`);
}
if (report.schema !== 'vmz.locale.check.v0' || report.status !== 'ready') {
    fail(`report bad: ${JSON.stringify(report).slice(0, 800)}`);
}
if (report.manifest?.defaultLocale !== 'zh-hans') fail('defaultLocale');
const ids = (report.manifest?.locales || []).map((l) => l.id);
if (JSON.stringify(ids) !== JSON.stringify(['zh-hans', 'zh-hant', 'en-us'])) {
    fail(`locale order ${JSON.stringify(ids)}`);
}
if (!(report.catalogIds || []).includes('account') || !(report.catalogIds || []).includes('common')) {
    fail(`catalogIds ${JSON.stringify(report.catalogIds)}`);
}
if (!(report.messageCatalog?.messages || []).some((m) => m.messageId === 'account.actions.save')) {
    fail('expected MessageId account.actions.save');
}

console.log(': reject invalid LocaleId en-US…');
const badId = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i0-id-'));
fs.mkdirSync(path.join(badId, 'locales', 'en-US'), { recursive: true });
fs.writeFileSync(
    path.join(badId, 'locales', 'locales.json5'),
    `{ schemaVersion: 1, defaultLocale: 'en-US', locales: [{ id: 'en-US', label: 'EN' }], fallback: {} }`,
);
fs.writeFileSync(path.join(badId, 'locales', 'en-US', 'common.json5'), '{ ok: "OK" }\n');
const bad = runVmz(['locale', 'check', badId, '--json']);
if (bad.status === 0) fail('en-US should fail');
const badReport = JSON.parse(bad.stdout);
if (!(badReport.diagnostics || []).some((d) => d.code === 'vmz::locale::id_invalid')) {
    fail(`want id_invalid: ${JSON.stringify(badReport.diagnostics).slice(0, 600)}`);
}

console.log(': reject fallback cycle…');
const cycleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i0-cycle-'));
fs.mkdirSync(path.join(cycleDir, 'locales', 'zh-hans'), { recursive: true });
fs.mkdirSync(path.join(cycleDir, 'locales', 'en-us'), { recursive: true });
fs.writeFileSync(
    path.join(cycleDir, 'locales', 'locales.json5'),
    `{
  schemaVersion: 1,
  defaultLocale: 'zh-hans',
  locales: [
    { id: 'zh-hans', label: 'zh' },
    { id: 'en-us', label: 'en' },
  ],
  fallback: { 'zh-hans': ['en-us'], 'en-us': ['zh-hans'] },
}`,
);
fs.writeFileSync(path.join(cycleDir, 'locales', 'zh-hans', 'common.json5'), '{ ok: "1" }\n');
fs.writeFileSync(path.join(cycleDir, 'locales', 'en-us', 'common.json5'), '{ ok: "1" }\n');
const cycle = runVmz(['locale', 'check', cycleDir, '--json']);
if (cycle.status === 0) fail('cycle should fail');
const cycleReport = JSON.parse(cycle.stdout);
if (!(cycleReport.diagnostics || []).some((d) => d.code === 'vmz::locale::fallback_cycle')) {
    fail(`want fallback_cycle: ${JSON.stringify(cycleReport.diagnostics).slice(0, 600)}`);
}

console.log(': missing locales.json5 is warning (not silent, not error yet)…');
const noLocale = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i0-nolocale-'));
fs.mkdirSync(path.join(noLocale, 'src'), { recursive: true });
const missing = runVmz(['locale', 'check', noLocale, '--json']);
if (missing.status !== 0) {
    fail(`missing locales must be warning-only (exit 0), got ${missing.status}\n${missing.stdout}\n${missing.stderr}`);
}
const missingReport = JSON.parse(missing.stdout);
const missDiag = (missingReport.diagnostics || []).find((d) => d.code === 'vmz::locale::manifest_missing');
if (!missDiag) {
    fail(`want manifest_missing warning: ${JSON.stringify(missingReport.diagnostics).slice(0, 600)}`);
}
if (missDiag.severity !== 'warning') {
    fail(`manifest_missing severity want warning, got ${missDiag.severity}`);
}
if (missingReport.status !== 'ready') {
    fail(`missing locales status want ready, got ${missingReport.status}`);
}

console.log(' GATE PASS');
console.log(' locales.json5 · LocaleId · MessageId · fallback DAG · missing→warning');

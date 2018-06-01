/**
 * typed messages gate:
 * - ICU param extraction + cross-locale contract
 * - #locales/* typed module emit
 * - parameter mismatch fails check
 * - MessageId rename plan
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { extractMessageParams } from '../../../dist/locale-check.js';

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

console.log(': ICU param extract…');
const plural = extractMessageParams('{count, plural, =0 {none} one {#} other {# items}}');
if (!plural.ok || !plural.params.some((p) => p.name === 'count' && p.kind === 'plural')) {
    fail(`plural params: ${JSON.stringify(plural)}`);
}
const badPlural = extractMessageParams('{count, plural, one {#}}');
if (badPlural.ok) fail('plural without other must fail');

console.log(': emit-types for fixture…');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i1-types-'));
const emit = runVmz(['locale', 'emit-types', fixture, '--out', outDir]);
if (emit.status !== 0) fail(`emit-types failed\n${emit.stdout}\n${emit.stderr}`);
const accountDts = path.join(outDir, 'account.d.ts');
if (!fs.existsSync(accountDts)) fail('missing account.d.ts');
const dts = fs.readFileSync(accountDts, 'utf8');
if (!dts.includes('export declare function save(): LocalizedText')) fail(`save() missing:\n${dts}`);
if (!dts.includes('greeting(args: { name: string })')) fail(`greeting args missing:\n${dts}`);
if (!dts.includes('itemCount(args: { count: number })')) fail(`itemCount args missing:\n${dts}`);

console.log(': parameter mismatch fails…');
const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i1-param-'));
for (const loc of ['zh-hans', 'en-us']) {
    fs.mkdirSync(path.join(badDir, 'locales', loc), { recursive: true });
}
fs.writeFileSync(
    path.join(badDir, 'locales', 'locales.json5'),
    `{
  schemaVersion: 1,
  defaultLocale: 'zh-hans',
  locales: [
    { id: 'zh-hans', label: 'zh' },
    { id: 'en-us', label: 'en' },
  ],
  fallback: { 'en-us': [] },
}`,
);
fs.writeFileSync(path.join(badDir, 'locales', 'zh-hans', 'account.json5'), `{ greeting: '你好，{name}' }\n`);
fs.writeFileSync(path.join(badDir, 'locales', 'en-us', 'account.json5'), `{ greeting: 'Hello, {username}' }\n`);
const bad = runVmz(['locale', 'check', badDir, '--json']);
if (bad.status === 0) fail('parameter mismatch should fail');
const badReport = JSON.parse(bad.stdout);
if (!(badReport.diagnostics || []).some((d) => d.code === 'vmz::locale::message_parameter_mismatch')) {
    fail(`want parameter_mismatch: ${JSON.stringify(badReport.diagnostics).slice(0, 800)}`);
}

console.log(': rename plan…');
const rename = runVmz(['locale', 'rename', 'account.actions.save', 'account.actions.persist', fixture, '--json']);
if (rename.status !== 0) fail(`rename failed\n${rename.stdout}\n${rename.stderr}`);
const plan = JSON.parse(rename.stdout);
if (plan.schema !== 'vmz.locale.rename.v0' || plan.status !== 'ready') fail(`rename plan ${JSON.stringify(plan)}`);
if (!(plan.edits || []).length) fail('rename edits empty');

console.log(': dogfood thin slice — build emits dist/locales runtime…');
const built = runVmz(['build', fixture], fixture);
if (built.status !== 0) fail(`fixture build failed\n${built.stdout}\n${built.stderr}`);
const runtimeJs = path.join(fixture, 'dist', 'locales', 'common.js');
const accountJs = path.join(fixture, 'dist', 'locales', 'account.js');
if (!fs.existsSync(runtimeJs)) fail('missing dist/locales/common.js after build');
if (!fs.existsSync(accountJs)) fail('missing dist/locales/account.js after build');
if (fs.existsSync(path.join(fixture, 'dist', '#locales'))) {
    fail('dist/#locales must not exist (ESM file URL fragment hazard)');
}
const clientJs = fs.readFileSync(path.join(fixture, 'dist', 'pages', 'index.client.js'), 'utf8');
if (clientJs.includes('#locales/')) fail('client still imports bare #locales/ after rewrite');
if (!clientJs.includes('locales/common.js') || !clientJs.includes('locales/account.js')) {
    fail(`client missing relative locales imports:\n${clientJs.slice(0, 400)}`);
}
const commonSrc = fs.readFileSync(runtimeJs, 'utf8');
if (!commonSrc.includes('export function brand') || !commonSrc.includes('__vmzLocaleId')) {
    fail('common.js missing LocalizedText exports / locale picker');
}

console.log(' GATE PASS');
console.log(' ICU params · #locales typed modules · mismatch · rename · runtime emit thin slice');

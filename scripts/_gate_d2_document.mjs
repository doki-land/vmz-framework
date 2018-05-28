/**
 * D2 document evidence gate:
 * - vmz/ts fences checked (run → compile plan)
 * - vmz-api: refs resolved from Program Graph
 * - missing API / bad fence fail document check
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
    console.error(`D2 GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args, cwd = root) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log('D2: document check fixture (fences + API)…');
const check = runVmz(['document', 'check', fixture, '--strict', '--json']);
if (check.status !== 0) {
    fail(`check failed\n${check.stdout}\n${check.stderr}`);
}
let manifest;
try {
    manifest = JSON.parse(check.stdout);
} catch (e) {
    fail(`check --json not JSON: ${e}\n${check.stdout}`);
}
const evidence = manifest.evidence;
if (!evidence || evidence.schema !== 'vmz.document.evidence.v0') {
    fail(`missing evidence schema: ${JSON.stringify(evidence).slice(0, 400)}`);
}
if (evidence.status !== 'ready') fail(`evidence status ${evidence.status}`);
if (!(evidence.fences || []).some((f) => f.lang === 'vmz' && f.status === 'ok' && f.run)) {
    fail(`expected ok vmz run fence: ${JSON.stringify(evidence.fences).slice(0, 800)}`);
}
if (!(evidence.fences || []).some((f) => (f.lang === 'ts' || f.lang === 'typescript') && f.status === 'ok')) {
    fail(`expected ok ts fence`);
}
if (!(evidence.apiRefs || []).some((r) => r.query.includes('DemoCard') && r.status === 'ok')) {
    fail(`expected DemoCard api ref ok: ${JSON.stringify(evidence.apiRefs).slice(0, 800)}`);
}
if (!(evidence.testSelections || []).some((t) => t.status === 'ready')) {
    fail(`expected testSelection from run fence`);
}

console.log('D2: document build emits document.evidence.json…');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d2-'));
const build = runVmz(['document', 'build', fixture, '--out', outDir, '--strict']);
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);
const evPath = path.join(outDir, 'document.evidence.json');
if (!fs.existsSync(evPath)) fail('missing document.evidence.json');
const builtEv = JSON.parse(fs.readFileSync(evPath, 'utf8'));
if (builtEv.schema !== 'vmz.document.evidence.v0' || builtEv.status !== 'ready') {
    fail(`built evidence bad: ${JSON.stringify(builtEv).slice(0, 600)}`);
}

console.log('D2: missing API must fail check…');
const badApi = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d2-api-'));
fs.mkdirSync(path.join(badApi, 'documents', 'zh-hans'), { recursive: true });
fs.writeFileSync(
    path.join(badApi, 'documents', 'documents.config.json'),
    JSON.stringify({ defaultLocale: 'zh-hans', locales: { 'zh-hans': { label: 'z' } } }),
);
fs.writeFileSync(path.join(badApi, 'documents', 'zh-hans', 'index.md'), '# Hi\n\n[Ghost](vmz-api:components/DoesNotExist)\n');
const badApiCheck = runVmz(['document', 'check', badApi, '--strict']);
if (badApiCheck.status === 0) fail('missing API should fail');
if (!`${badApiCheck.stdout}\n${badApiCheck.stderr}`.includes('document::api::missing')) {
    fail(`want api::missing\n${badApiCheck.stdout}\n${badApiCheck.stderr}`);
}

console.log('D2: bad ts fence must fail check…');
const badTs = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d2-ts-'));
fs.mkdirSync(path.join(badTs, 'documents', 'zh-hans'), { recursive: true });
fs.writeFileSync(
    path.join(badTs, 'documents', 'documents.config.json'),
    JSON.stringify({ defaultLocale: 'zh-hans', locales: { 'zh-hans': { label: 'z' } } }),
);
fs.writeFileSync(path.join(badTs, 'documents', 'zh-hans', 'index.md'), '# Hi\n\n```ts\nconst x: number = ;\n```\n');
const badTsCheck = runVmz(['document', 'check', badTs, '--strict']);
if (badTsCheck.status === 0) fail('bad ts fence should fail');
if (!`${badTsCheck.stdout}\n${badTsCheck.stderr}`.includes('document::fence::check_failed')) {
    fail(`want fence::check_failed\n${badTsCheck.stdout}\n${badTsCheck.stderr}`);
}

console.log('D2 GATE PASS');
console.log('  vmz/ts fences · run→testSelection · vmz-api Program Graph · evidence artifact');

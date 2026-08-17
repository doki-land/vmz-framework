/**
 * Browser Host gate: U0–U2 on real Chrome (CDP).
 * Not Playwright test model — puppeteer-core is CDP transport only.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const counter = path.join(root, 'packages', 'examples', 'counter');
const router = path.join(root, 'packages', 'examples', 'production-router');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`-BROWSER GATE FAIL: ${msg}`);
    process.exit(1);
}

const { resolveBrowserExecutable } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
);
const chrome = resolveBrowserExecutable();
if (!chrome) {
    fail('Chrome/Edge not found — set VMZ_BROWSER');
}
console.log(`-browser gate: using ${chrome}`);

function runVmzTest(project, filter, label) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t2b-'));
    const reportPath = path.join(tmp, 'report.json');
    console.log(`-browser gate: ${label}`);
    const run = spawnSync(process.execPath, [vmzBin, 'test', project, '--mode', 'browser', '--filter', filter, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) {
        fail(`vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') {
        fail(`report.status want passed, got ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
    }
    return report;
}

const counterReport = runVmzTest(counter, 'counter\\.browser', 'vmz test counter.browser…');
for (const id of [
    'counter.browser.increment',
    'counter.browser.precision',
    'counter.browser.destroy',
    'counter.browser.u1',
    'counter.browser.select',
    'counter.browser.select.ui',
]) {
    const hit = (counterReport.tests || []).find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') fail(`${id} not passed`);
    console.log(` ${hit.testId} → ok`);
}

const timingInfo = (counterReport.tests || [])
    .flatMap((t) => t.diagnostics || [])
    .find((d) => d && String(d.message || '').includes('browser timing:'));
if (!timingInfo) fail('expected browser timing diagnostic on counter.browser.select');
const timingPath = String(timingInfo.message).replace(/^browser timing:\s*/, '');
if (!fs.existsSync(timingPath)) fail(`timing.json missing: ${timingPath}`);
const timingDoc = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
if (timingDoc.schema !== 'vmz.test.browser.timing.v0' || !Array.isArray(timingDoc.steps) || timingDoc.steps.length < 2) {
    fail(`timing.json invalid: ${JSON.stringify(timingDoc).slice(0, 400)}`);
}
console.log(` timing evidence → ${timingDoc.steps.length} steps`);

const routerReport = runVmzTest(router, 'router\\.browser\\.u2', 'vmz test router.browser.u2 (serve-host)…');
const u2 = (routerReport.tests || []).find((t) => t.testId === 'router.browser.u2');
if (!u2 || u2.status !== 'passed') fail('router.browser.u2 not passed');
console.log(` ${u2.testId} → ok`);

console.log('-BROWSER GATE PASS');
console.log(' U0–U2 + native/UI select + timing evidence on real Chrome');

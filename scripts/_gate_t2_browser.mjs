/**
 * T2 Browser Host gate: vmz test --mode browser on real Chrome (CDP).
 * Not Playwright test model — puppeteer-core is CDP transport only.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`T2-BROWSER GATE FAIL: ${msg}`);
    process.exit(1);
}

const { resolveBrowserExecutable } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
);
const chrome = resolveBrowserExecutable();
if (!chrome) {
    fail('Chrome/Edge not found — set VMZ_BROWSER');
}
console.log(`T2-browser gate: using ${chrome}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t2b-'));
const reportPath = path.join(tmp, 'report.json');

console.log('T2-browser gate: vmz test --mode browser --filter counter.browser…');
const run = spawnSync(process.execPath, [vmzBin, 'test', counter, '--mode', 'browser', '--filter', 'counter\\.browser', '--json', reportPath], {
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
for (const id of ['counter.browser.increment', 'counter.browser.precision', 'counter.browser.destroy']) {
    const hit = (report.tests || []).find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') fail(`${id} not passed`);
    console.log(`  ${hit.testId} → ok`);
}

console.log('T2-BROWSER GATE PASS');
console.log('  increment + precision + destroy on real Chrome');

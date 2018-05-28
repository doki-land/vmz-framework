/**
 * L3 gate (thin): compile half + ssr/hydrate mode.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`L3 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-l3-'));
const reportPath = path.join(tmp, 'report.json');

console.log('L3 gate: vmz test compile + ssr…');
const run = spawnSync(
    process.execPath,
    [vmzBin, 'test', example, '--mode', 'compile,ssr', '--filter', 'l3\\.|counter\\.compile\\.direct', '--json', reportPath],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
if (run.status !== 0) {
    fail(`vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') {
    fail(`report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}
for (const id of ['l3.compile.counter', 'l3.ssr.hydrate.counter']) {
    const hit = (report.tests || []).find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
}

console.log('L3 GATE PASS: shared Plan + Direct mount/SSR/hydrate (no production render)');

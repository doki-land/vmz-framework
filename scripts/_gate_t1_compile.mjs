/**
 * T1 gate (first slice): vmz test --mode compile executes graph/plan assertions.
 *
 * Usage (repo root): node scripts/_gate_t1_compile.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`T1 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t1-'));
const reportPath = path.join(tmp, 'report.json');

console.log('T1 gate: vmz test --mode compile --json…');
const run = spawnSync(process.execPath, [vmzBin, 'test', counter, '--mode', 'compile', '--json', reportPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (run.status !== 0) {
    fail(`vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.schema !== 'vmz.test.report.v0') fail(`bad report schema ${report.schema}`);
if (report.status !== 'passed') {
    fail(`report.status want passed, got ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}
const hit = (report.tests || []).find((t) => t.testId === 'counter.compile.direct');
if (!hit) fail('missing counter.compile.direct');
if (hit.status !== 'passed') fail(`test status want passed, got ${hit.status}`);
if (hit.programId !== 'components/CounterButton') fail(`programId ${hit.programId}`);
if (hit.planId !== 'vmz.plan.v0') fail(`planId want vmz.plan.v0, got ${hit.planId}`);
if (Array.isArray(hit.diagnostics) && hit.diagnostics.some((d) => d?.severity === 'error')) {
    fail(`unexpected diagnostics: ${JSON.stringify(hit.diagnostics)}`);
}

console.log('T1 GATE PASS (compile slice)');
console.log(`  ${hit.testId} → ${hit.status} (plan ${hit.planId})`);

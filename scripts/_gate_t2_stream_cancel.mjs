/**
 * T2 stream cancel / backpressure gate:
 * AbortSignal stops further yields; consumer pull delay is respected.
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
    console.error(`T2-STREAM-CANCEL GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t2sc-'));
const reportPath = path.join(tmp, 'report.json');

console.log('T2-stream-cancel: vmz test --mode ssr --filter counter.ssr.stream.cancel…');
const run = spawnSync(
    process.execPath,
    [vmzBin, 'test', counter, '--mode', 'ssr', '--filter', 'counter\\.ssr\\.stream\\.cancel', '--json', reportPath],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
if (run.status !== 0) {
    fail(`vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') {
    fail(`report.status want passed, got ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}
const hit = (report.tests || []).find((t) => t.testId === 'counter.ssr.stream.cancel');
if (!hit || hit.status !== 'passed') fail('counter.ssr.stream.cancel not passed');

console.log('T2-STREAM-CANCEL GATE PASS');
console.log('  abort mid-stream + pull-paced backpressure');

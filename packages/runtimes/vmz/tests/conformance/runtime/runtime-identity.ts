/**
 * runtime-identity — plan-backed hydrate/resume preserves DOM node identity.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`runtime-identity GATE FAIL: ${msg}`);
    process.exit(1);
}

function runTest(example, filter, label) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-rt-id-'));
    const reportPath = path.join(tmp, 'report.json');
    const run = spawnSync(process.execPath, [vmzBin, 'test', example, '--filter', filter, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) {
        fail(`${label}: vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') {
        fail(`${label}: report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
    }
    for (const t of report.tests || []) {
        if (t.status !== 'passed') fail(`${label}: failed ${t.testId}`);
        const nodeId = (t.assertions || []).find((a) => a.kind === 'nodeIdentity');
        if (nodeId && nodeId.status !== 'passed') {
            fail(`${label}: nodeIdentity failed in ${t.testId}`);
        }
    }
}

console.log('runtime-identity: island resume nodeIdentity…');
runTest(path.join(root, 'packages', 'examples', 'island'), 'resume\\.resume\\.island', 'island-resume');

console.log('runtime-identity: counter browser hydrate nodeIdentity…');
runTest(path.join(root, 'packages', 'examples', 'counter'), 'counter\\.browser\\.increment', 'counter-hydrate');

console.log('runtime-identity GATE PASS: resume + hydrate preserve node identity');

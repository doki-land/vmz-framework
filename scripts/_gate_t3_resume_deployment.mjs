/**
 * T3 gate: Resume / Deployment / async cancel / N-API session evidence.
 *
 * - deployment mode: server capability isolation + resumeEntries IR
 * - resume mode: L5 island adopt (reuse)
 * - async cancel: stream cancel gate (reuse)
 * - N-API long-lived session: n2 gate (reuse)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`T3 GATE FAIL: ${msg}`);
    process.exit(1);
}

function runNode(script) {
    console.log(`→ ${script}`);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'inherit',
    });
    if (r.status !== 0) fail(`${script} exited ${r.status}`);
}

function runVmzTest(projectRel, filter, expectIds) {
    const project = path.join(root, ...projectRel.split('/'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t3-'));
    const reportPath = path.join(tmp, 'report.json');
    console.log(`→ vmz test ${projectRel} --filter ${filter}`);
    const run = spawnSync(process.execPath, [vmzBin, 'test', project, '--mode', 'deployment', '--filter', filter, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) {
        fail(`vmz test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') {
        fail(`report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
    }
    for (const id of expectIds) {
        const hit = (report.tests || []).find((t) => t.testId === id);
        if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
    }
}

console.log('T3 gate: deployment isolation…');
runVmzTest('packages/examples/fullstack', '^t3\\.deployment\\.', ['t3.deployment.usercard.isolation']);
runVmzTest('packages/examples/island', '^t3\\.deployment\\.', ['t3.deployment.island.resume']);

console.log('T3 gate: resume host (L5)…');
runNode('_gate_l5_resume.mjs');

console.log('T3 gate: async cancel / backpressure…');
runNode('_gate_t2_stream_cancel.mjs');

console.log('T3 gate: N-API long-lived session…');
runNode('_gate_n2_node_cli.mjs');

console.log('T3 GATE PASS: deployment isolation + resume + async cancel + N-API session');

/**
 * lifetime (thin): lifetime compile + logic dispose manifests.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`lifetime FAIL: ${msg}`);
    process.exit(1);
}

function runProject(rel, filter, wantIds) {
    const project = path.join(root, rel);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-lifetime-'));
    const reportPath = path.join(tmp, 'report.json');
    console.log(`lifetime: ${rel} --filter ${filter}`);
    const run = spawnSync(process.execPath, [vmzBin, 'test', project, '--filter', filter, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) {
        fail(`${rel} exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') {
        fail(`${rel} report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
    }
    for (const id of wantIds) {
        const hit = (report.tests || []).find((t) => t.testId === id);
        if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
    }
}

runProject('packages/examples/fullstack', '^l4\\.', [
    'l4.compile.branch.lifetime',
    'l4.compile.usercard.lifetime',
    'l4.logic.each.dispose',
    'l4.logic.if.region',
]);
runProject('packages/examples/counter', '^l4\\.logic\\.nested', ['l4.logic.nested.destroy']);

console.log('lifetime PASS: lifetime owns/disposes + dispose_region + nested/each dispose');

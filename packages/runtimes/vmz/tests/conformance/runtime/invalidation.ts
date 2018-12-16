/**
 * invalidation — runtime region dispose schedule (ExecutionPlan dispose-region + lifetime logic).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`invalidation GATE FAIL: ${msg}`);
    process.exit(1);
}

function runProject(rel, filter, wantIds) {
    const project = path.join(root, rel);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inval-'));
    const reportPath = path.join(tmp, 'report.json');
    const run = spawnSync(process.execPath, [vmzBin, 'test', project, '--filter', filter, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) fail(`${rel} exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') fail(`${rel} report ${report.status}`);
    for (const id of wantIds) {
        const hit = (report.tests || []).find((t) => t.testId === id);
        if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
    }
}

console.log('invalidation: fullstack if/each lifetime logic…');
runProject('packages/examples/fullstack', '^l4\\.logic\\.(each|if)', ['l4.logic.each.dispose', 'l4.logic.if.region']);

const programPath = path.join(root, 'packages/examples/fullstack/dist/web-ssr/components/UserCard.program.json');
if (!fs.existsSync(programPath)) {
    const build = spawnSync(process.execPath, [vmzBin, 'build', path.join(root, 'packages/examples/fullstack')], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);
}
const program = JSON.parse(fs.readFileSync(programPath, 'utf8'));
const unit = (program.units || [])[0] || program;
const dispose = (unit.plan?.nodes || []).filter((n: { kind: string }) => n.kind === 'dispose-region');
if (!dispose.length) fail('UserCard plan missing dispose-region nodes');

console.log('invalidation GATE PASS: dispose-region plan + if/each lifetime logic');

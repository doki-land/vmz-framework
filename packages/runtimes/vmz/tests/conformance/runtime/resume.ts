/**
 * resume gate (thin): compile resumeEntries + resume host manifests.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'island');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`resume GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-resume-'));
const reportPath = path.join(tmp, 'report.json');

console.log('resume: vmz test --filter ^resume\\.');
const run = spawnSync(process.execPath, [vmzBin, 'test', example, '--filter', '^resume\\.', '--json', reportPath], {
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
for (const id of ['resume.compile.resume.entries', 'resume.resume.island', 'resume.compile.event.entry', 'resume.event.entry']) {
    const hit = (report.tests || []).find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
}

console.log('resume GATE PASS: resumeEntries + EventEntry + Island SSR/resume');

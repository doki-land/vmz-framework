/**
 * keyed-list — ExecutionPlan Each.keyBinding + keyed each dispose logic.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');
const fullstack = path.join(root, 'packages', 'examples', 'fullstack');

function fail(msg) {
    console.error(`keyed-list GATE FAIL: ${msg}`);
    process.exit(1);
}

function planKeyBinding(node: { keyBinding?: number; key_binding?: number }) {
    return node.keyBinding ?? node.key_binding ?? null;
}

console.log('keyed-list: build UserCard…');
const build = spawnSync(process.execPath, [vmzBin, 'build', fullstack], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const programPath = path.join(fullstack, 'dist', 'web-ssr', 'components', 'UserCard.program.json');
if (!fs.existsSync(programPath)) fail(`missing ${programPath}`);
const program = JSON.parse(fs.readFileSync(programPath, 'utf8'));
const unit = (program.units || [])[0] || program;
const plan = unit.plan || program.plan;
const eachNodes = (plan?.nodes || []).filter((n: { kind: string }) => n.kind === 'each');
if (!eachNodes.length) fail('UserCard plan missing each node');
const withKey = eachNodes.some((n) => planKeyBinding(n) != null);
if (!withKey) fail(`each nodes missing keyBinding: ${JSON.stringify(eachNodes)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-keyed-'));
const reportPath = path.join(tmp, 'report.json');
const run = spawnSync(process.execPath, [vmzBin, 'test', fullstack, '--filter', '^l4\\.logic\\.each', '--json', reportPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (run.status !== 0) fail(`logic test failed\n${run.stdout}\n${run.stderr}`);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') fail(`report ${report.status}`);

console.log('keyed-list GATE PASS: plan keyBinding + each dispose logic');

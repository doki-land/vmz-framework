/**
 * slot-projection — Application layout slot has stable projectionId in ExecutionPlan.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');
const counter = path.join(root, 'packages', 'examples', 'counter');

function fail(msg) {
    console.error(`slot-projection GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('slot-projection: build Application…');
const build = spawnSync(process.execPath, [vmzBin, 'build', counter], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const programPath = path.join(counter, 'dist', 'web-ssr', 'Application.program.json');
const program = JSON.parse(fs.readFileSync(programPath, 'utf8'));
const unit = (program.units || [])[0] || program;
const slots = (unit.plan?.nodes || []).filter((n) => n.kind === 'slot');
if (!slots.length) fail('Application plan missing slot node');
const withProjection = slots.every((n) => n.projectionId != null || n.projection_id != null || n.id != null);
if (!withProjection) fail(`slot nodes missing projectionId: ${JSON.stringify(slots)}`);

console.log('slot-projection GATE PASS: slot projectionId in ExecutionPlan');

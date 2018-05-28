/**
 * L4 WriteBarrier suite: static + array + shared + logical slices.
 * Usage: pnpm gate:l4-wb
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
    console.error(`L4-WB GATE FAIL: ${msg}`);
    process.exit(1);
}

function run(script) {
    console.log(`→ ${script}`);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'inherit',
    });
    if (r.status !== 0) fail(`${script} exited ${r.status}`);
}

run('_gate_l4_write_barrier.mjs');
run('_gate_l4_write_barrier_array.mjs');
run('_gate_l4_write_barrier_shared.mjs');
run('_gate_l4_write_barrier_logical.mjs');

console.log('L4-WB GATE PASS: static + array + shared + logical');

/**
 * T2 gate: ssr + resume modes via vmz test.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
    console.error(`T2 GATE FAIL: ${msg}`);
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

run('_gate_l3_shared_plan.mjs');
run('_gate_l5_resume.mjs');
run('_gate_t2_stream.mjs');
run('_gate_t2_stream_cancel.mjs');
run('_gate_t2_browser.mjs');

console.log('T2 GATE PASS: ssr + stream + cancel/backpressure + resume + browser hosts');

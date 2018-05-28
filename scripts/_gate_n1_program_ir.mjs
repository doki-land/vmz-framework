/**
 * N1 gate: CLI Workspace build and Node N-API build emit byte-identical `*.program.json`.
 *
 * Usage (repo root): node scripts/_gate_n1_program_ir.mjs
 * Requires: `pnpm napi:build` (or existing packages/runtimes/vmz/*.node)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, PROGRAM_IR_SCHEMA } from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'packages', 'examples', 'hello');

function walkProgramJson(dir, base = dir, out = new Map()) {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walkProgramJson(full, base, out);
        else if (name.endsWith('.program.json')) {
            const rel = path.relative(base, full).split(path.sep).join('/');
            out.set(rel, fs.readFileSync(full, 'utf8'));
        }
    }
    return out;
}

function fail(msg) {
    console.error(`N1 GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n1-ir-'));
const distCli = path.join(tmp, 'cli');
const distNapi = path.join(tmp, 'napi');

console.log('N1 gate: building via CLI Workspace…');
const cli = spawnSync(
    'cargo',
    ['run', '--quiet', '--manifest-path', path.join(root, 'Cargo.toml'), '-p', 'vmz-tools', '--', 'build', example, '--out-dir', distCli],
    { cwd: root, stdio: 'inherit' },
);
if (cli.status !== 0) fail(`CLI build exited ${cli.status}`);

console.log('N1 gate: building via Node N-API Workspace…');
const ws = createWorkspace({ root: example, outDir: distNapi });
const report = ws.build();
const errors = (report.diagnostics || []).filter((d) => d.severity === 'error');
if (errors.length) fail(`N-API build errors: ${JSON.stringify(errors)}`);

const cliMap = walkProgramJson(distCli);
const napiMap = walkProgramJson(distNapi);
if (cliMap.size === 0) fail('CLI emitted no *.program.json');
if (cliMap.size !== napiMap.size) {
    fail(`file count mismatch CLI=${cliMap.size} NAPI=${napiMap.size}`);
}

for (const [rel, cliBody] of cliMap) {
    const napiBody = napiMap.get(rel);
    if (napiBody == null) fail(`missing in N-API dist: ${rel}`);
    if (cliBody !== napiBody) {
        fail(`byte mismatch: ${rel}\n--- CLI ---\n${cliBody}\n--- NAPI ---\n${napiBody}`);
    }
    if (!cliBody.includes(PROGRAM_IR_SCHEMA)) {
        fail(`${rel} missing schema ${PROGRAM_IR_SCHEMA}`);
    }
}

// queryProgramGraph must return the same bytes as the emitted file
const queried = ws.queryProgramGraph(path.join('src', 'Application.vmz'));
const appJson = napiMap.get('Application.program.json');
if (!appJson) fail('expected Application.program.json under hello dist');
if (queried !== appJson) fail('queryProgramGraph !== emitted Application.program.json');

ws.dispose();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`N1 GATE OK: ${cliMap.size} program.json file(s) byte-identical (CLI Workspace ≡ Node N-API)`);

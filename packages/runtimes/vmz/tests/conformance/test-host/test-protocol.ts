/**
 * test-host: freeze TestManifest/TestReport schemas + vmz test --list/--json.
 *
 * Usage (repo root): node scripts/_gate_t0_test_protocol.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { EXECUTION_PLAN_REF_SCHEMA, TEST_ACTION_SCHEMA, TEST_ASSERTION_SCHEMA, TEST_MANIFEST_SCHEMA, TEST_REPORT_SCHEMA } from '@vmz/protocol';

const root = repoRoot(import.meta.url);
const counter = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

const protocol = await import(pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz', 'dist', 'test-protocol.js')).href);

const wantSchemas = {
    TEST_MANIFEST_SCHEMA,
    TEST_REPORT_SCHEMA,
    TEST_ACTION_SCHEMA,
    TEST_ASSERTION_SCHEMA,
    EXECUTION_PLAN_REF_SCHEMA,
};
for (const [k, v] of Object.entries(wantSchemas)) {
    if (protocol[k] !== v) fail(`${k} want ${v}, got ${protocol[k]}`);
}

const fixture = path.join(counter, 'tests', 'counter-compile.vmz.test.json');
if (!fs.existsSync(fixture)) fail(`missing fixture ${fixture}`);
const manifest = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const v = protocol.validateManifest(manifest, fixture);
if (!v.ok) fail(v.error);

console.log('test-host: vmz test --list…');
const list = spawnSync(process.execPath, [vmzBin, 'test', counter, '--list'], {
    cwd: root,
    encoding: 'utf8',
});
if (list.status !== 0) {
    fail(`--list exited ${list.status}\n${list.stdout}\n${list.stderr}`);
}
if (!list.stdout.includes('counter.compile.direct')) {
    fail(`--list missing counter.compile.direct:\n${list.stdout}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-t0-'));
const reportPath = path.join(tmp, 'report.json');
console.log('test-host: vmz test --list --json…');
const json = spawnSync(process.execPath, [vmzBin, 'test', counter, '--list', '--json', reportPath], {
    cwd: root,
    encoding: 'utf8',
});
if (json.status !== 0) {
    fail(`--json exited ${json.status}\n${json.stdout}\n${json.stderr}`);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.schema !== protocol.TEST_REPORT_SCHEMA) {
    fail(`report.schema want ${protocol.TEST_REPORT_SCHEMA}, got ${report.schema}`);
}
if (report.status !== 'listed' && report.status !== 'empty') {
    fail(`report.status unexpected ${report.status}`);
}
const hit = (report.tests || []).find((t) => t.testId === 'counter.compile.direct');
if (!hit) fail(`report missing counter.compile.direct: ${JSON.stringify(report.tests)}`);
if (hit.status !== 'listed') fail(`test status want listed, got ${hit.status}`);
if (hit.programId !== 'components/CounterButton') {
    fail(`programId want components/CounterButton, got ${hit.programId}`);
}
if (!Array.isArray(hit.modes) || !hit.modes.includes('compile')) {
    fail(`modes missing compile: ${JSON.stringify(hit.modes)}`);
}

// required TestReport fields from design
for (const key of ['testId', 'programId', 'planId', 'status', 'diagnostics', 'trace', 'snapshots', 'coverage', 'unknownReasons']) {
    if (!(key in hit)) fail(`TestReport entry missing ${key}`);
}

console.log(' GATE PASS');
console.log(` schemas: ${Object.values(wantSchemas).join(', ')}`);
console.log(` listed: ${hit.testId} @ ${hit.file}`);

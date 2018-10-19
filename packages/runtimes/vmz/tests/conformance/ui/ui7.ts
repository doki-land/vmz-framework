/**
 * UI7 conformance pack thin gate — external fixtures under @vmz/ui/conformance
 * assert Motion IR depth (token + region affects + cancel + plan) on homepage program.json,
 * then prove the same contract via `vmz test --mode compile` motion assertions.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const homepage = path.join(root, 'packages', 'homepage');
const packDir = path.join(root, 'packages', 'ui', 'vmz-ui', 'conformance');
const packPath = path.join(packDir, 'pack.v0.json');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`ui7 GATE FAIL: ${msg}`);
    process.exit(1);
}

function unitOf(program) {
    return (program.units && program.units[0]) || program;
}

function assertMotion(label, unit, expect) {
    const motion = unit.motion || {};
    const transitions = motion.transitions || [];
    const edges = unit.graph?.edges || [];
    const planNodes = unit.plan?.nodes || [];

    if (expect.status != null && motion.status !== expect.status) {
        fail(`${label}: motion.status want ${expect.status}, got ${motion.status}`);
    }
    if (expect.nonEmpty === true && transitions.length === 0) {
        fail(`${label}: motion.transitions empty`);
    }
    if (Array.isArray(expect.kinds)) {
        const have = new Set(transitions.map((t) => String(t.kind || '')));
        for (const k of expect.kinds) {
            if (!have.has(String(k))) fail(`${label}: motion missing kind=${k}: ${[...have]}`);
        }
    }
    if (typeof expect.token === 'string') {
        if (!transitions.some((t) => t.token === expect.token)) {
            fail(`${label}: motion missing token=${expect.token}: ${JSON.stringify(transitions)}`);
        }
    }
    if (expect.cancelable === true && !transitions.some((t) => t.cancelable === true)) {
        fail(`${label}: motion missing cancelable transition`);
    }
    if (expect.generation === true && !transitions.some((t) => t.generation === true)) {
        fail(`${label}: motion missing generation transition`);
    }
    if (typeof expect.reducedMotion === 'string') {
        if (!transitions.every((t) => t.reduced_motion === expect.reducedMotion)) {
            fail(`${label}: reduced_motion want ${expect.reducedMotion}`);
        }
    }
    if (expect.hasRegion === true && !transitions.some((t) => t.region != null)) {
        fail(`${label}: motion missing region`);
    }
    if (expect.affectsRegion === true) {
        const hit = edges.some((e) => e.kind === 'affects' && String(e.from).startsWith('motion:') && String(e.to).startsWith('region:'));
        if (!hit) {
            fail(`${label}: missing motion→region affects: ${JSON.stringify(edges.filter((e) => String(e.from).startsWith('motion:')))}`);
        }
    }
    if (Array.isArray(expect.cancelsFrom)) {
        for (const from of expect.cancelsFrom) {
            const hit = edges.some((e) => e.kind === 'cancels' && e.from === from && String(e.to).startsWith('motion:'));
            if (!hit) fail(`${label}: missing cancels from ${from}`);
        }
    }
    if (expect.planMotionTransition === true && !planNodes.some((n) => n.kind === 'motion_transition')) {
        fail(`${label}: plan missing motion_transition`);
    }
}

if (!fs.existsSync(packPath)) fail(`missing pack ${packPath}`);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
if (pack.schema !== 'vmz.ui.conformance.pack.v0') fail(`bad pack schema ${pack.schema}`);
if (pack.id !== 'ui7') fail(`pack.id want ui7, got ${pack.id}`);
if (!Array.isArray(pack.fixtures) || pack.fixtures.length === 0) fail('pack.fixtures empty');

console.log('ui7: build homepage (program.json for @vmz/ui components)…');
const build = spawnSync(process.execPath, [vmzBin, 'build', homepage], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) {
    fail(`homepage build failed\n${build.stdout || ''}\n${build.stderr || ''}`);
}

for (const rel of pack.fixtures) {
    const fixturePath = path.join(packDir, rel);
    if (!fs.existsSync(fixturePath)) fail(`missing fixture ${rel}`);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (fixture.schema !== 'vmz.ui.conformance.fixture.v0') {
        fail(`${rel}: bad fixture schema ${fixture.schema}`);
    }
    const component = fixture.artifact?.component;
    if (!component) fail(`${rel}: artifact.component required`);
    const programPath = path.join(homepage, 'dist', 'components', `${component}.program.json`);
    if (!fs.existsSync(programPath)) fail(`${rel}: missing ${programPath}`);
    const unit = unitOf(JSON.parse(fs.readFileSync(programPath, 'utf8')));
    const assertions = Array.isArray(fixture.assertions) ? fixture.assertions : [];
    if (!assertions.length) fail(`${rel}: assertions empty`);
    for (const a of assertions) {
        if (a.kind === 'motion') {
            assertMotion(fixture.id || rel, unit, a.expect || {});
        } else {
            fail(`${rel}: unsupported assertion kind ${a.kind} (ui7 thin pack: motion only)`);
        }
    }
    console.log(`ui7: ${fixture.id} OK`);
}

console.log('ui7: vmz test --mode compile --filter ^ui7\\. …');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ui7-'));
const reportPath = path.join(tmp, 'report.json');
const testRun = spawnSync(process.execPath, [vmzBin, 'test', homepage, '--mode', 'compile', '--filter', '^ui7\\.', '--json', reportPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (testRun.status !== 0) {
    fail(`vmz test compile exited ${testRun.status}\n${testRun.stdout || ''}\n${testRun.stderr || ''}`);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.schema !== 'vmz.test.report.v0') fail(`bad report schema ${report.schema}`);
if (report.status !== 'passed') {
    fail(`vmz test report.status want passed, got ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}
const wantIds = ['ui7.dialog.motion.compile', 'ui7.drawer.motion.compile', 'ui7.button.motion.compile'];
for (const id of wantIds) {
    const hit = (report.tests || []).find((t) => t.testId === id);
    if (!hit) fail(`missing ${id} in report`);
    if (hit.status !== 'passed') fail(`${id} status want passed, got ${hit.status}`);
}
console.log(`ui7: vmz test compile OK (${wantIds.length})`);

console.log(`ui7 PASS: ${pack.fixtures.length} fixture(s) + vmz test motion assertions — Motion IR depth + conformance pack`);

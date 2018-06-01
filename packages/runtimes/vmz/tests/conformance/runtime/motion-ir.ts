/**
 * Motion compiler IR thin gate — Dialog/Drawer program.json carries MotionView
 * transitions (owner/trigger/cancel/generation) + plan motion_transition nodes + graph cancel edges.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const homepage = path.join(root, 'packages', 'homepage');
const cargo = process.env.CARGO || 'cargo';

function fail(msg) {
    console.error(`motion-ir GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('motion-ir: build homepage (emits Dialog/Drawer/Button program.json)…');
const build = spawnSync(cargo, ['run', '-p', 'vmz-tools', '--quiet', '--', 'build', homepage], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) {
    fail(`homepage build failed\n${build.stdout || ''}\n${build.stderr || ''}`);
}

function readProgram(name) {
    const p = path.join(homepage, 'dist', 'components', `${name}.program.json`);
    if (!fs.existsSync(p)) fail(`missing ${name}.program.json`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function unitOf(program) {
    return (program.units && program.units[0]) || program;
}

function assertOverlayMotion(name, overlayKind) {
    const unit = unitOf(readProgram(name));
    const motion = unit.motion || {};
    if (motion.status !== 'partial') fail(`${name}: motion.status want partial, got ${motion.status}`);
    const transitions = motion.transitions || [];
    const enter = transitions.find((t) => t.kind === 'overlay-enter');
    const exit = transitions.find((t) => t.kind === 'overlay-exit');
    if (!enter || !exit) {
        fail(`${name}: missing overlay-enter/exit transitions: ${JSON.stringify(transitions)}`);
    }
    if (!String(enter.name || '').includes(overlayKind)) {
        fail(`${name}: enter name should include ${overlayKind}, got ${enter.name}`);
    }
    if (enter.trigger !== 'open' || exit.trigger !== 'dismiss') {
        fail(`${name}: triggers want open/dismiss, got ${enter.trigger}/${exit.trigger}`);
    }
    if (!enter.cancelable || !enter.generation || !exit.cancelable || !exit.generation) {
        fail(`${name}: overlay transitions must be cancelable+generation`);
    }
    if (enter.reduced_motion !== 'honor' || exit.reduced_motion !== 'honor') {
        fail(`${name}: reduced_motion must be honor`);
    }
    if (enter.token !== 'motion.overlay' || exit.token !== 'motion.overlay') {
        fail(`${name}: overlay token want motion.overlay, got ${enter.token}/${exit.token}`);
    }
    const edges = unit.graph?.edges || [];
    const hasReverse = edges.some((e) => e.kind === 'cancels' && e.from === 'motion:reverse' && String(e.to).startsWith('motion:'));
    const hasCancelExit = edges.some((e) => e.kind === 'cancels' && e.from === 'effect:_cancelExit' && String(e.to).startsWith('motion:'));
    const hasDestroy = edges.some((e) => e.kind === 'cancels' && e.from === 'lifecycle:destroy' && String(e.to).startsWith('motion:'));
    const hasAffects = edges.some((e) => e.kind === 'affects' && String(e.from).startsWith('motion:') && String(e.to).startsWith('region:'));
    if (!hasReverse || !hasCancelExit || !hasDestroy) {
        fail(
            `${name}: missing motion cancel edges reverse/_cancelExit/destroy: ${JSON.stringify(edges.filter((e) => String(e.to).startsWith('motion:')))}`,
        );
    }
    if (!hasAffects) {
        fail(`${name}: missing motion→region affects edges`);
    }
    const planNodes = unit.plan?.nodes || [];
    if (!planNodes.some((n) => n.kind === 'motion_transition')) {
        fail(`${name}: Execution Plan missing motion_transition nodes`);
    }
    console.log(`motion-ir: ${name} overlay motion OK`);
}

assertOverlayMotion('Dialog', 'dialog');
assertOverlayMotion('Drawer', 'drawer');

{
    const unit = unitOf(readProgram('Button'));
    const transitions = unit.motion?.transitions || [];
    const control = transitions.find((t) => t.kind === 'control');
    if (!control) fail(`Button: missing control motion transition: ${JSON.stringify(transitions)}`);
    if (control.trigger !== 'control' || control.reduced_motion !== 'honor') {
        fail(`Button: control transition shape: ${JSON.stringify(control)}`);
    }
    if (control.token !== 'motion.control') {
        fail(`Button: control token want motion.control, got ${control.token}`);
    }
    console.log('motion-ir: Button control motion OK');
}

console.log('motion-ir PASS: MotionView + plan motion_transition + cancel edges');

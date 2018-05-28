/**
 * L4 AsyncTask 入图 gate: compiler lifts async effects to __vmzRunTask;
 * program.json carries async_task + spawns/cancels; destroy cancels compiled path.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`L4-ASYNC-GRAPH GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('L4-async-graph: build counter…');
const build = spawnSync(process.execPath, [vmzBin, 'build', counter], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const dist = path.join(counter, 'dist');
const clientJs = fs.readFileSync(path.join(dist, 'components', 'CounterButton.client.js'), 'utf8');
if (!clientJs.includes('__vmzRunTask(this, "softLoad"') && !clientJs.includes("__vmzRunTask(this, 'softLoad'")) {
    fail('CounterButton.client.js missing __vmzRunTask wrap for softLoad');
}
if (!/from\s+['"].*vmz-dom/.test(clientJs)) {
    fail('CounterButton.client.js must import __vmzRunTask from vmz-dom');
}

const program = JSON.parse(fs.readFileSync(path.join(dist, 'components', 'CounterButton.program.json'), 'utf8'));
const unit = (program.units || [])[0] || program;
const resources = unit.resource?.resources || unit.resources || [];
const task = resources.find((r) => r.kind === 'async_task' && r.name === 'softLoad');
if (!task) {
    fail(`program.json missing async_task softLoad: ${JSON.stringify(resources)}`);
}
const edges = unit.graph?.edges || [];
const hasSpawns = edges.some((e) => e.kind === 'spawns' && String(e.from).includes('softLoad') && String(e.to).startsWith('task:'));
const hasCancels = edges.some((e) => e.kind === 'cancels' && String(e.to).startsWith('task:'));
if (!hasSpawns) fail(`missing spawns edge for softLoad: ${JSON.stringify(edges)}`);
if (!hasCancels) fail(`missing cancels edge: ${JSON.stringify(edges)}`);

const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
const Comp = (await import(pathToFileURL(path.join(dist, 'components', 'CounterButton.client.js')).href)).default;

const { parseHTML } = await import('linkedom');
const { window } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.AbortController = AbortController;

const app = document.getElementById('app');
const inst = await dom.mount(Comp, app, { initial: 0 });

const p = inst.softLoad();
dom.destroy(inst);
await p;
if (dom.__vmzTaskStatus(inst, 'softLoad') !== 'cancelled') {
    fail(`compiled softLoad destroy want cancelled, got ${dom.__vmzTaskStatus(inst, 'softLoad')}`);
}
if (inst.count === 7) fail('destroyed softLoad must not apply count=7');

// Supersede via compiled wrap: newer generation wins.
const inst2 = await dom.mount(Comp, app, { initial: 0 });
const slow = inst2.softLoad();
await new Promise((r) => setTimeout(r, 5));
const newer = inst2.softLoad();
await newer;
await slow;
if (dom.__vmzTaskStatus(inst2, 'softLoad') !== 'success') {
    fail(`supersede want success on newer, got ${dom.__vmzTaskStatus(inst2, 'softLoad')}`);
}
if (inst2.count !== 7) fail(`newer softLoad should set count=7, got ${inst2.count}`);

console.log('L4-ASYNC-GRAPH GATE PASS');
console.log('  emit __vmzRunTask + program async_task/spawns/cancels + destroy cancel');

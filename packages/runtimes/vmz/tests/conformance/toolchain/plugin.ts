/**
 * gate: fixture contributions validated by Rust; no VPG mutation;
 * Program IR still emitted by core.
 *
 * Usage: node scripts/_gate_n3_plugin.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_PROTOCOL, applyPlugins, createWorkspace } from 'vmz';
import protocolFixture from 'vmz-fixtures';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n3-gate-'));
fs.mkdirSync(path.join(dir, 'src'));
fs.writeFileSync(
    path.join(dir, 'src', 'Application.vmz'),
    `<template><p>n3</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
);
const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });

console.log(' gate: reject graph_mutation…');
const bad = ws.applyPluginContributions({
    pluginName: 'evil',
    pluginVersion: '0.0.1',
    protocol: PLUGIN_PROTOCOL,
    stage: 'workspace_resolve',
    cacheKey: 'bad',
    items: [{ id: 'x', kind: 'graph_mutation', detail: 'mutate' }],
});
if (bad.accepted !== 0 || !bad.rejected?.length) fail('graph_mutation must be rejected');

console.log(' gate: apply protocol fixture…');
const reports = await applyPlugins(ws, [protocolFixture], { project: dir, outDir });
const accepted = reports.reduce((n, r) => n + (r.accepted || 0), 0);
if (accepted < 2) fail(`expected ≥2 accepted contributions, got ${accepted}`);

console.log(' gate: build (Rust owns Program IR)…');
const built = ws.build();
const errors = (built.diagnostics || []).filter((d) => d.severity === 'error');
if (errors.length) fail(JSON.stringify(errors));

const targets = path.join(outDir, 'vmz-plugin-targets.json');
const program = path.join(outDir, 'Application.program.json');
if (!fs.existsSync(targets)) fail('missing vmz-plugin-targets.json');
if (!fs.existsSync(program)) fail('missing Application.program.json');
const ir = JSON.parse(fs.readFileSync(program, 'utf8'));
if (ir.schema !== 'vmz.program.v0') fail(`bad schema ${ir.schema}`);

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(` GATE OK: plugin protocol ${PLUGIN_PROTOCOL}; contributions validated; Program IR from Rust core`);

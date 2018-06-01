/**
 * dirty sources / session graph.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import {
    createRolldownPluginVmzAdapter,
    createVitePluginVmzAdapter,
    createWorkspace,
    loadDeploymentIr,
    planAffectedBundleInputs,
    planBundleInputs,
    resolveWorkspacePackages,
} from 'vmz';

function fail(msg) {
    console.error(`session GATE FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n4-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
const body = (name) => `<template><p>${name}</p></template>\n<script client>\nexport default class ${name} {}\n</script>\n`;
const a = path.join(dir, 'src', 'components', 'A.vmz');
const b = path.join(dir, 'src', 'components', 'B.vmz');
const card = path.join(dir, 'src', 'components', 'Card.vmz');
const page = path.join(dir, 'src', 'pages', 'index.vmz');
fs.writeFileSync(a, body('A'));
fs.writeFileSync(b, body('B'));
fs.writeFileSync(
    card,
    `<template>
  <p if={ready}>{label}</p>
</template>
<script client>
import { CardServer } from '#server/components/Card';
export default class Card {
  ready = false;
  label = '';
  async onMount() {
    this.label = await CardServer.load();
    this.ready = true;
  }
}
</script>
<script server>
export default class CardServer {
  async load() { return 'ok'; }
}
</script>
`,
);
fs.writeFileSync(page, `<template><Card /><A /></template>\n<script client>\nexport default class Index {}\n</script>\n`);
fs.writeFileSync(
    path.join(dir, 'src', 'Application.vmz'),
    `<template><slot /></template>\n<script client>\nexport default class Application {}\n</script>\n`,
);

const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });

console.log('session gate: full build…');
const full = ws.build();
if ((full.diagnostics || []).some((d) => d.severity === 'error')) {
    fail(JSON.stringify(full.diagnostics));
}
if (!full.full) fail('first build must be full');
if (!fs.existsSync(path.join(outDir, 'vmz-deployment.json'))) {
    fail('missing vmz-deployment.json');
}

const ir0 = loadDeploymentIr(outDir);
const pageUnit = (ir0.units || []).find((u) => u.chunkId === 'pages/index');
if (!pageUnit) fail('missing pages/index unit');
const deps = pageUnit.dependsOn || [];
if (!deps.includes('components/Card') || !deps.includes('components/A')) {
    fail(`pages/index dependsOn missing Card/A: ${JSON.stringify(deps)}`);
}
const cardUnit = (ir0.units || []).find((u) => u.chunkId === 'components/Card');
if (!(cardUnit?.dependedBy || []).includes('pages/index')) {
    fail(`Card dependedBy missing pages/index: ${JSON.stringify(cardUnit)}`);
}
if (!(cardUnit?.capabilities || []).includes('load')) {
    fail(`Card capabilities missing load: ${JSON.stringify(cardUnit)}`);
}
if (!Array.isArray(cardUnit?.regionIds) || cardUnit.regionIds.length < 1) {
    fail(`Card regionIds expected from if={}: ${JSON.stringify(cardUnit)}`);
}
if (!cardUnit?.serverModuleId) {
    fail(`Card serverModuleId missing: ${JSON.stringify(cardUnit)}`);
}
ws.dispose();

const ws2 = createWorkspace({ root: dir, outDir });
fs.writeFileSync(a, body('A2'));
ws2.updateFiles([{ path: a, kind: 'update' }]);
const plan = ws2.queryAffected();
if (plan.full) fail('affected plan must not be full');
const planChunks = (plan.units || []).map((u) => u.chunkId).sort();
if (!planChunks.includes('components/A') || !planChunks.includes('pages/index')) {
    fail(`expected A + pages/index via reverse edge, got ${JSON.stringify(planChunks)}`);
}
if (planChunks.includes('components/B')) {
    fail(`unrelated B should not be affected: ${JSON.stringify(planChunks)}`);
}
if (!(plan.seedChunks || []).includes('components/A')) {
    fail(`seedChunks missing A: ${JSON.stringify(plan.seedChunks)}`);
}
if (plan.islandOnly) fail('page importer ⇒ islandOnly must be false');

console.log('session gate: affected rebuild (reverse edge)…');
const inc = ws2.build();
if (inc.full) fail('incremental build must not be full');
if (!inc.affectedChunks?.includes('components/A') || !inc.affectedChunks?.includes('pages/index')) {
    fail(`affectedChunks=${JSON.stringify(inc.affectedChunks)}`);
}
if (inc.islandHmr) fail('islandHmr must be false when page is affected');
const emitted = (inc.emitted || []).map((p) => p.replaceAll('\\', '/'));
if (emitted.some((p) => p.endsWith('B.client.js') || p.endsWith('B.program.json'))) {
    fail(`sibling B re-emitted: ${emitted.join(', ')}`);
}
if (!emitted.some((p) => p.endsWith('A.client.js') || p.endsWith('A.program.json'))) {
    fail(`A not re-emitted: ${emitted.join(', ')}`);
}
ws2.dispose();

const ws3 = createWorkspace({ root: dir, outDir });
fs.writeFileSync(b, body('B2'));
ws3.updateFiles([{ path: b, kind: 'update' }]);
const planB = ws3.queryAffected();
if (planB.full) fail('B plan must not be full');
if (planB.units.length !== 1 || planB.units[0].chunkId !== 'components/B') {
    fail(`expected only B, got ${JSON.stringify(planB)}`);
}
if (!planB.islandOnly) fail('orphan component dirt should be islandOnly');
const incB = ws3.build();
if (!incB.islandHmr) fail('islandHmr expected for orphan component');
if (incB.affectedChunks?.includes('pages/index')) {
    fail('page must not rebuild for orphan B');
}
ws3.dispose();

console.log('session gate: bundler adapter consumes Deployment IR…');
const ir = loadDeploymentIr(outDir);
const inputs = planBundleInputs(outDir, ir);
if (inputs.length < 2) fail(`expected ≥2 bundle inputs, got ${inputs.length}`);
const affected = planAffectedBundleInputs(outDir, ir);
if (!affected.some((e) => e.chunkId.includes('B'))) {
    fail(`affected bundle inputs missing B: ${JSON.stringify(affected)}`);
}
if (createVitePluginVmzAdapter({ outDir }).name !== 'vmz-deployment-adapter') {
    fail('vite adapter name');
}
if (createRolldownPluginVmzAdapter({ outDir }).name !== 'vmz-deployment-adapter-rolldown') {
    fail('rolldown adapter name');
}

console.log('session gate: explain provenance…');
const ws4 = createWorkspace({ root: dir, outDir });
const explainJson = ws4.explain('components/Card');
if (!explainJson.includes('vmz.dx.explain.v0') || !explainJson.includes('components/Card')) {
    fail(`explain bad: ${explainJson.slice(0, 400)}`);
}
const capExplain = ws4.explain('capability:load');
if (!capExplain.includes('components/Card')) {
    fail(`capability explain missing Card: ${capExplain.slice(0, 400)}`);
}
const edgeExplain = ws4.explain('components/Card#binding:0');
if (!edgeExplain.includes('"kind": "binding"') || !edgeExplain.includes('"edge"')) {
    fail(`edge explain bad: ${edgeExplain.slice(0, 500)}`);
}
const session = ws4.querySessionGraph();
if (!session.includes('vmz.session.v0') || !session.includes('components/Card')) {
    fail(`session graph bad: ${session.slice(0, 400)}`);
}
if (typeof ws4.sessionGeneration() !== 'number') {
    fail('sessionGeneration missing');
}
ws4.dispose();

console.log('session gate: workspace package resolution…');
const root = repoRoot(import.meta.url);
const pkgs = resolveWorkspacePackages(root);
if (!pkgs.some((p) => p.name === '@vmz/vmz')) {
    fail(`expected @vmz/vmz package in workspace, got ${pkgs.map((p) => p.name).join(',')}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('session GATE OK: reverse edges + capability/region + islandHmr + explain/edge + session graph + packages + Rolldown');

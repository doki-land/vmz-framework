/**
 * X1 gate: RouteId/field rename TextEdits + atomic apply + graph→test + causal explain.
 *
 * Design: `规划设计/vmz/21` §10 X1 收口.
 *
 * Usage (repo root): pnpm gate:x1
 * Requires: `pnpm napi:build` + built `vmz` / `@vmz/protocol` JS
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    DX_EXPLAIN_SCHEMA,
    DX_PROTOCOL,
    DX_RENAME_SCHEMA,
    DX_TEST_SELECTION_SCHEMA,
    DX_WORKSPACE_EDIT_SCHEMA,
    createWorkspace,
    dxCatalog,
} from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`X1 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('X1 gate: DX catalog includes rename + test_selection…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail(`dxCatalog schema ${jsDx.schema}`);
for (const [kind, schema] of [
    ['rename', DX_RENAME_SCHEMA],
    ['test_selection', DX_TEST_SELECTION_SCHEMA],
]) {
    const row = jsDx.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x1-'));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'Index.vmz'),
    `<router>
{ id: "home", path: "/" }
</router>
<template>
  <Link to="home" />
  <p if={label}>{label}</p>
</template>
<script client>
export default class Index {
  label = "hi";
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'tests', 'index.vmz.test.json'),
    JSON.stringify(
        {
            schema: 'vmz.test.manifest.v0',
            id: 'index.compile',
            modes: ['compile'],
            program: { chunkId: 'pages/index', unitName: 'Index' },
        },
        null,
        2,
    ),
);

const outDir = path.join(dir, 'dist');
console.log('X1 gate: RouteId rename plan + apply…');
const ws = createWorkspace({ root: dir, outDir });
const intent = {
    schema: DX_RENAME_SCHEMA,
    kind: 'route_id',
    from: 'home',
    to: 'landing',
};
if (typeof ws.planRename !== 'function') fail('planRename missing');
const planRaw = ws.planRename(JSON.stringify(intent));
let plan;
try {
    plan = JSON.parse(planRaw);
} catch (e) {
    fail(`plan not JSON: ${e}`);
}
if (plan.schema !== DX_WORKSPACE_EDIT_SCHEMA) fail(`plan schema ${plan.schema}`);
if (plan.status !== 'ready') fail(`want ready, got ${plan.status}: ${planRaw.slice(0, 600)}`);
if (!Array.isArray(plan.edits) || plan.edits.length < 2) {
    fail(`want >=2 TextEdits, got ${plan.edits?.length}`);
}
if (!plan.preconditions?.includes('x1.symbol_reference_proven')) {
    fail('missing x1.symbol_reference_proven');
}
const causal = plan.preconditions.find((p) => String(p).startsWith('causalChainId='));
if (!causal) fail('missing causalChainId precondition');

if (typeof ws.applyWorkspaceEdit !== 'function') fail('applyWorkspaceEdit missing');
const appliedRaw = ws.applyWorkspaceEdit(planRaw);
const applied = JSON.parse(appliedRaw);
if (applied.status !== 'applied') {
    fail(`apply status ${applied.status}: ${appliedRaw.slice(0, 500)}`);
}
const text = fs.readFileSync(path.join(dir, 'src', 'Index.vmz'), 'utf8');
if (!text.includes('landing') || text.includes('to="home"')) {
    fail(`file not updated: ${text}`);
}

console.log('X1 gate: field rename…');
const fieldPlan = JSON.parse(
    ws.planRename(
        JSON.stringify({
            schema: DX_RENAME_SCHEMA,
            kind: 'field',
            from: 'label',
            to: 'title',
        }),
    ),
);
if (fieldPlan.status !== 'ready' || !fieldPlan.edits?.length) {
    fail(`field rename ${JSON.stringify(fieldPlan).slice(0, 500)}`);
}

console.log('X1 gate: graph→test selection…');
// Drop router-bearing Index (unknown SFC tag in current parser) before full build.
fs.writeFileSync(
    path.join(dir, 'src', 'Index.vmz'),
    `<template><p>host</p></template>
<script client>
export default class Index {}
</script>
`,
);
// Stable page path → chunkId pages/index (matches test manifest).
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template><p>page</p></template>
<script client>
export default class IndexPage {}
</script>
`,
);
const wsGraph = createWorkspace({ root: dir, outDir });
const built = wsGraph.build();
const be = (built.diagnostics || []).filter((d) => d.severity === 'error');
if (be.length) fail(`pages/index build errors: ${JSON.stringify(be)}`);
wsGraph.updateFiles([{ path: path.join(dir, 'src', 'pages', 'index.vmz'), kind: 'update' }]);
const sel2 = JSON.parse(wsGraph.selectTestsAffected());
if (sel2.schema !== DX_TEST_SELECTION_SCHEMA) fail('sel2 schema');
if (!(sel2.testIds || []).includes('index.compile')) {
    fail(`want index.compile selected, got ${JSON.stringify(sel2)}`);
}
if (sel2.status !== 'ready') fail(`want ready selection, got ${sel2.status}`);
if (!(sel2.reason || '').includes('graph')) {
    fail(`want graph→test reason, got ${sel2.reason}`);
}
wsGraph.dispose();
ws.dispose();

console.log('X1 gate: causal explain chain…');
const wsExplain = createWorkspace({ root: dir, outDir });
// Restore route id for explain of landing→home after prior apply
fs.writeFileSync(path.join(dir, 'src', 'Index.vmz'), `<template><Link to="landing" /></template>\n`);
const explainRaw = wsExplain.explainRenameChain(
    JSON.stringify({
        schema: DX_RENAME_SCHEMA,
        kind: 'route_id',
        from: 'landing',
        to: 'home',
    }),
);
const explain = JSON.parse(explainRaw);
if (explain.schema !== DX_EXPLAIN_SCHEMA) fail(`explain schema ${explain.schema}`);
if (explain.kind !== 'rename') fail(`explain kind ${explain.kind}`);
if (!Array.isArray(explain.chain) || explain.chain.length < 1) {
    fail(`explain chain empty: ${explainRaw.slice(0, 400)}`);
}
const reasons = explain.chain.map((e) => e.reason);
if (!reasons.some((r) => String(r).includes('rename'))) {
    fail(`chain reasons ${JSON.stringify(reasons)}`);
}
wsExplain.dispose();

console.log('X1 gate: CLI refactor rename --apply…');
fs.writeFileSync(path.join(dir, 'src', 'Index.vmz'), `<template><Link to="home" /></template>\n`);
const cli = spawnSync(
    process.execPath,
    [vmzBin, 'refactor', 'rename', '--kind', 'route_id', '--from', 'home', '--to', 'landing', dir, '--apply', '--json'],
    { encoding: 'utf8', cwd: root },
);
if (cli.status !== 0) fail(`CLI rename --apply failed\n${cli.stdout}\n${cli.stderr}`);
const cliPlan = JSON.parse(cli.stdout);
if (cliPlan.status !== 'applied') fail(`CLI status ${cliPlan.status}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log('X1 GATE OK: rename TextEdits + apply + graph→test + causal explain');

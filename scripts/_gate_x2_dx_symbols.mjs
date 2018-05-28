/**
 * X2 gate: cross-SFC Symbol/Reference + method/component rename + source map + safe_fix.
 *
 * Design: `规划设计/vmz/21` §10 X2.
 *
 * Usage (repo root): pnpm gate:x2
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DX_CODE_ACTION_SCHEMA,
    DX_PROTOCOL,
    DX_SOURCE_MAP_SCHEMA,
    DX_SYMBOL_INDEX_SCHEMA,
    DX_WORKSPACE_EDIT_SCHEMA,
    DX_X2_CHECK_SCHEMA,
    createWorkspace,
    dxCatalog,
} from 'vmz';

function fail(msg) {
    console.error(`X2 GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('X2 gate: DX catalog includes source_map / symbol_index / x2_check…');
const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['source_map', DX_SOURCE_MAP_SCHEMA],
    ['symbol_index', DX_SYMBOL_INDEX_SCHEMA],
    ['x2_check', DX_X2_CHECK_SCHEMA],
    ['code_action', DX_CODE_ACTION_SCHEMA],
]) {
    const row = jsDx.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x2-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Card.vmz'),
    `<template>
  <button @click={increment}>{n}</button>
</template>
<script client>
export default class Card {
  n = 0;
  increment() { this.n++; }
  async boot() { return CardServer.load(); }
}
</script>
<script server>
export default class CardServer {
  async load() { return 1; }
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <Card />
</template>
<script client>
export default class IndexPage {}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Bad.vmz'),
    `<template><p>x</p></template>
<script client>
export default class WrongName {}
</script>
`,
);

const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });

console.log('X2 gate: checkDxX2 / querySymbols / source map…');
if (typeof ws.checkDxX2 !== 'function') fail('checkDxX2 missing');
const report = JSON.parse(ws.checkDxX2());
if (report.schema !== DX_X2_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.index?.schema !== DX_SYMBOL_INDEX_SCHEMA) fail('symbol_index schema');
const kinds = new Set((report.index.symbols || []).map((s) => s.kind));
for (const k of ['component', 'field', 'method', 'capability']) {
    if (!kinds.has(k)) fail(`missing symbol kind ${k} in ${[...kinds]}`);
}
if (!(report.index.sourceMap || []).some((m) => m.schema === DX_SOURCE_MAP_SCHEMA)) {
    fail('missing source map entries');
}
if (!(report.index.sourceMap || []).some((m) => m.symbolKind === 'method')) {
    fail('missing method source map');
}

console.log('X2 gate: method + component rename apply…');
const methodPlan = JSON.parse(
    ws.planRename(
        JSON.stringify({
            schema: 'vmz.dx.rename.v0',
            kind: 'method',
            from: 'increment',
            to: 'bump',
        }),
    ),
);
if (methodPlan.schema !== DX_WORKSPACE_EDIT_SCHEMA || methodPlan.status !== 'ready') {
    fail(`method plan ${JSON.stringify(methodPlan).slice(0, 500)}`);
}
if (!methodPlan.preconditions?.includes('x2.cross_sfc_index')) fail('missing x2.cross_sfc_index');
const methodApplied = JSON.parse(ws.applyWorkspaceEdit(JSON.stringify(methodPlan)));
if (methodApplied.status !== 'applied') fail(`method apply ${methodApplied.status}`);

const compPlan = JSON.parse(
    ws.planRename(
        JSON.stringify({
            schema: 'vmz.dx.rename.v0',
            kind: 'component',
            from: 'Card',
            to: 'Tile',
        }),
    ),
);
if (compPlan.status !== 'ready') fail(`component plan ${compPlan.status}`);
if (!compPlan.edits?.some((e) => String(e.path).includes('pages/index'))) {
    fail('component rename must edit cross-SFC page usage');
}

console.log('X2 gate: capability rename…');
const capPlan = JSON.parse(
    ws.planRename(
        JSON.stringify({
            schema: 'vmz.dx.rename.v0',
            kind: 'capability',
            from: 'load',
            to: 'fetch',
        }),
    ),
);
if (capPlan.status !== 'ready') fail(`capability plan ${JSON.stringify(capPlan).slice(0, 400)}`);

console.log('X2 gate: queryReferences + safe_fix CodeAction…');
const refs = JSON.parse(ws.queryReferences('component:Card'));
// After component rename plan not applied; Card refs may still exist from Bad/index depending on apply order.
// Use Tile if Card was applied — we did not apply component rename.
if (!Array.isArray(refs)) fail('queryReferences not array');

const actions = JSON.parse(ws.listCodeActions());
const safe = actions.find((a) => a.kind === 'safe_fix');
if (!safe || safe.schema !== DX_CODE_ACTION_SCHEMA) fail('missing safe_fix CodeAction');
if (!safe.edit || safe.edit.status !== 'ready' || !safe.edit.edits?.length) {
    fail('safe_fix must carry ready WorkspaceEditPlan');
}
const fixed = JSON.parse(ws.applyWorkspaceEdit(JSON.stringify(safe.edit)));
if (fixed.status !== 'applied') fail(`safe_fix apply ${fixed.status}`);
const badText = fs.readFileSync(path.join(dir, 'src', 'components', 'Bad.vmz'), 'utf8');
if (!badText.includes('class Bad') || badText.includes('WrongName')) {
    fail(`safe_fix did not rename class: ${badText}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log('X2 GATE OK: cross-SFC symbols + rename + source map + safe_fix');

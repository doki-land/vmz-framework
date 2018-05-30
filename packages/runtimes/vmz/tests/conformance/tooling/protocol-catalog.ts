/**
 * protocol-catalog: unified DX + umbrella protocol (`vmz.protocol.v0` / `vmz.dx.v0`).
 *
 * Freezes catalog + Explain/Affected; JS `@vmz/protocol` must match native.
 *
 * Requires: `pnpm napi:build` (or existing packages/runtimes/vmz/*.node)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DX_AFFECTED_SCHEMA,
    DX_CODE_ACTION_SCHEMA,
    DX_EXPLAIN_SCHEMA,
    DX_PROTOCOL,
    DX_REFERENCE_SCHEMA,
    DX_SYMBOL_SCHEMA,
    DX_WORKSPACE_EDIT_SCHEMA,
    PROTOCOL_CATALOG_SCHEMA,
    createWorkspace,
    dxCatalog,
    protocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

const jsCatalog = protocolCatalog();
if (jsCatalog.schema !== PROTOCOL_CATALOG_SCHEMA) fail('JS protocolCatalog.schema mismatch');
for (const kind of ['dx', 'test', 'application']) {
    const row = jsCatalog.domains.find((d) => d.kind === kind);
    if (!row || !row.schema) fail(`JS protocolCatalog missing domain ${kind}`);
}

const jsDx = dxCatalog();
if (jsDx.schema !== DX_PROTOCOL || !Array.isArray(jsDx.documents) || jsDx.documents.length < 6) {
    fail('JS dxCatalog mismatch');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-x0-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'components', 'Card.vmz'),
    `<template><p>{label}</p></template>
<script client>
export default class Card {
  label = '';
}
</script>
`,
);

const outDir = path.join(dir, 'dist');
console.log('protocol-catalog: build + protocol / DX catalog / explain / affected…');
const ws = createWorkspace({ root: dir, outDir });
const report = ws.build();
const errors = (report.diagnostics || []).filter((d) => d.severity === 'error');
if (errors.length) fail(`build errors: ${JSON.stringify(errors)}`);

if (typeof ws.queryDxCatalog !== 'function') fail('queryDxCatalog missing on Workspace');
if (typeof ws.queryAffectedDx !== 'function') fail('queryAffectedDx missing on Workspace');
if (typeof ws.queryProtocolCatalog !== 'function') fail('queryProtocolCatalog missing on Workspace');

const umbrellaRaw = ws.queryProtocolCatalog();
let umbrella;
try {
    umbrella = JSON.parse(umbrellaRaw);
} catch (e) {
    fail(`protocol catalog not JSON: ${e}`);
}
if (umbrella.schema !== PROTOCOL_CATALOG_SCHEMA) fail(`umbrella schema: ${umbrella.schema}`);
if (umbrella.host !== jsCatalog.host || umbrella.program !== jsCatalog.program) {
    fail(`umbrella host/program mismatch vs @vmz/protocol: ${umbrellaRaw.slice(0, 400)}`);
}
for (const d of jsCatalog.domains) {
    const row = umbrella.domains.find((x) => x.kind === d.kind);
    if (!row || row.schema !== d.schema) fail(`umbrella missing domain ${d.kind}=${d.schema}`);
}

const catalogRaw = ws.queryDxCatalog();
let catalog;
try {
    catalog = JSON.parse(catalogRaw);
} catch (e) {
    fail(`catalog not JSON: ${e}`);
}
if (catalog.schema !== DX_PROTOCOL || catalog.protocol !== DX_PROTOCOL) {
    fail(`catalog protocol mismatch: ${catalogRaw.slice(0, 300)}`);
}
const expected = [
    ['symbol', DX_SYMBOL_SCHEMA],
    ['reference', DX_REFERENCE_SCHEMA],
    ['explain', DX_EXPLAIN_SCHEMA],
    ['workspace_edit', DX_WORKSPACE_EDIT_SCHEMA],
    ['code_action', DX_CODE_ACTION_SCHEMA],
    ['affected', DX_AFFECTED_SCHEMA],
];
if (!Array.isArray(catalog.documents) || catalog.documents.length < expected.length) {
    fail(`catalog documents length: ${catalogRaw.slice(0, 400)}`);
}
for (const [kind, schema] of expected) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`catalog missing ${kind}=${schema}`);
}

const explainRaw = ws.explain('components/Card');
let explain;
try {
    explain = JSON.parse(explainRaw);
} catch (e) {
    fail(`explain not JSON: ${e}`);
}
if (explain.schema !== DX_EXPLAIN_SCHEMA) fail(`explain schema: ${explain.schema}`);
if (explain.kind !== 'chunk' || !String(explain.chunkId || '').includes('Card')) {
    fail(`explain body: ${explainRaw.slice(0, 400)}`);
}
if (explainRaw.includes('vmz.explain.v0')) fail('legacy explain schema still emitted');

const affectedRaw = ws.queryAffectedDx();
let affected;
try {
    affected = JSON.parse(affectedRaw);
} catch (e) {
    fail(`affected dx not JSON: ${e}`);
}
if (affected.schema !== DX_AFFECTED_SCHEMA) fail(`affected schema: ${affected.schema}`);
if (!Array.isArray(affected.units)) fail('affected.units missing');

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: protocol.v0 + dx catalog + explain.v0 + affected.v0');

/**
 * dev-invalidation-closure — component change expands to importer page via affected plan.
 * verify id: dev-invalidation-closure
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from 'vmz';

function fail(msg: string) {
    console.error(`dev-invalidation-closure FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dev-inv-'));
fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
const cardPath = path.join(dir, 'src', 'components', 'Card.vmz');
const pagePath = path.join(dir, 'src', 'pages', 'index.vmz');
fs.writeFileSync(
    cardPath,
    `<template><button @click="increment">{{ n }}</button></template>
<script client>
export default class Card { n = 0; increment() { this.n++; } }
</script>
`,
);
fs.writeFileSync(
    pagePath,
    `<template><Card /></template>
<script client>
export default class IndexPage {}
</script>
`,
);
const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });
const initial = ws.build();
if (initial.diagnostics?.some((d) => d.severity === 'error')) fail('initial build errors');

fs.writeFileSync(
    cardPath,
    `<template><button @click="increment">{{ n }}!</button></template>
<script client>
export default class Card { n = 0; increment() { this.n++; } }
</script>
`,
);
ws.updateFiles([{ path: cardPath, kind: 'update' }]);
let hmr: { rerun_loaders?: string[]; rerunLoaders?: string[]; affected_chunks?: string[]; affectedChunks?: string[] } | null = null;
try {
    hmr = JSON.parse(ws.queryHmrPlan());
} catch {
    fail('queryHmrPlan failed');
}
const rerun = hmr?.rerun_loaders ?? hmr?.rerunLoaders ?? [];
const affected = hmr?.affected_chunks ?? hmr?.affectedChunks ?? [];
if (!rerun.includes('pages/index') && !affected.some((c) => String(c).includes('pages/index'))) {
    fail(`importer page not in HMR plan: rerun=${JSON.stringify(rerun)} affected=${JSON.stringify(affected)}`);
}

const report = ws.build();
if (report.reloadRequired === false) fail('reloadRequired should be true after component edit');

console.log('dev-invalidation-closure PASS');
process.exit(0);

/**
 * dev-rebuild-convergence — artifact diff suppresses redundant soft reload.
 * verify id: dev-rebuild-convergence
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from 'vmz';
import { shouldSoftReload } from '../../../dist/dev-incremental.js';

function fail(msg: string) {
    console.error(`dev-rebuild-convergence FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dev-conv-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template><p>Hi</p></template>
<script client>
export default class IndexPage {}
</script>
`,
);
const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });
const first = ws.build();
if (first.diagnostics?.some((d) => d.severity === 'error')) fail('initial build errors');
const rev1 = first.outputRevision ?? '';
if (!rev1) fail('missing outputRevision on first build');

ws.clearDirty?.();
const second = ws.build();
const rev2 = second.outputRevision ?? '';
if (rev1 !== rev2) fail(`outputRevision changed without dirty input: ${rev1} vs ${rev2}`);
if (shouldSoftReload(second, rev1)) fail('shouldSoftReload must be false when revision unchanged');

console.log('dev-rebuild-convergence PASS');
process.exit(0);

/**
 * verify id: runtime-reshape-manifest
 * Host and Package Contract — declaration ownership manifest must match sources.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const script = path.join(root, 'scripts/refactor/reshape-runtime.mjs');

console.log('runtime-reshape-manifest: check declaration ownership…');
const r = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) {
    console.error('runtime-reshape-manifest FAIL');
    process.exit(1);
}

console.log(
    JSON.stringify({
        ok: true,
        id: 'runtime-reshape-manifest',
    }),
);
console.log('runtime-reshape-manifest PASS');

/**
 * cancellation — async task cancel edges (wraps async-graph evidence).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;
const asyncGraph = path.join(root, 'packages', 'runtimes', 'vmz', 'tests', 'conformance', 'runtime', 'async-graph.ts');

function fail(msg) {
    console.error(`cancellation GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('cancellation: delegate async-graph…');
const run = spawnSync(process.execPath, ['--import', resolveHook, '--experimental-strip-types', asyncGraph], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
});
if (run.status !== 0) fail('async-graph failed');

console.log('cancellation GATE PASS: compiled async cancel + destroy supersede');

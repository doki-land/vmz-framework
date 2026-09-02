/**
 * Generated client modules must not ship blueprint or generic bind/if/each interpreters.
 * verify id: no-generic-component-interpreter
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { scanBrowserClosureForGenericExports, scanGeneratedForGenericRuntimeApi } from '../_lib/source-lint-gate.ts';
import { assertNoGenericComponentInterpreter, buildAndScanSpecialized } from '../_lib/specialized-component-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`no-generic-component-interpreter FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-generic-component-interpreter: build + forbid generic interpreter…');
let scan;
try {
    scan = buildAndScanSpecialized(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertNoGenericComponentInterpreter(scan);
errors.push(...scanGeneratedForGenericRuntimeApi(scan.dist));
const closureModules = scan.boundary.modules.runtimeShared || [];
errors.push(...scanBrowserClosureForGenericExports(root, closureModules));
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'no-generic-component-interpreter',
    status: 'passed',
    detail: `generated=${scan.directModules.length}; genericApi=0; closureExports=0`,
});
writeProof(proof, root);

console.log('no-generic-component-interpreter PASS');

/**
 * Generated client modules must not ship blueprint render interpreters.
 * verify id: no-generic-component-interpreter
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertNoGenericComponentInterpreter, buildAndScanSpecialized } from '../_lib/specialized-component-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`no-generic-component-interpreter FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-generic-component-interpreter: build + forbid blueprint render…');
let scan;
try {
    scan = buildAndScanSpecialized(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertNoGenericComponentInterpreter(scan);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'no-generic-component-interpreter',
    status: 'passed',
    detail: `generated=${scan.directModules.length}; violations=0`,
});
addLimitation(proof, 'shared runtime still hosts generic bind/each/if for non-specialized paths');
writeProof(proof, root);

console.log('no-generic-component-interpreter PASS');

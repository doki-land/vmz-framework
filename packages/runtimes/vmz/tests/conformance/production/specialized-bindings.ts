/**
 * Direct emit uses specFieldText / specFieldAttr / onMethod where eligible.
 * verify id: specialized-bindings
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertSpecializedBindings, buildAndScanSpecialized } from '../_lib/specialized-component-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`specialized-bindings FAIL: ${msg}`);
    process.exit(1);
}

console.log('specialized-bindings: build + scan specialized emit…');
let scan;
try {
    scan = buildAndScanSpecialized(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertSpecializedBindings(scan);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'specialized-bindings',
    status: 'passed',
    detail: `kinds=${scan.specializedKinds.join('|')}; hits=${scan.specializedHits}`,
});
writeProof(proof, root);

console.log(`specialized-bindings PASS: ${scan.specializedKinds.join(', ')}`);

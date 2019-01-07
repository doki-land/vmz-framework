/**
 * Direct-eligible components emit __vmzDirect + __vmzCreate (no blueprint render).
 * verify id: generated-component-code
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertGeneratedComponentCode, buildAndScanSpecialized } from '../_lib/specialized-component-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`generated-component-code FAIL: ${msg}`);
    process.exit(1);
}

console.log('generated-component-code: build + scan Direct artifacts…');
let scan;
try {
    scan = buildAndScanSpecialized(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertGeneratedComponentCode(scan);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'generated-component-code',
    status: 'passed',
    detail: `directModules=${scan.directModules.length}; vmzCreate=${scan.boundary.specializedEmitSignals.find((s) => s.id === 'vmzCreate')?.files.length ?? 0}`,
});
addLimitation(proof, 'registry / dynamic load still runtime-owned; specialized create only');
writeProof(proof, root);

console.log(
    `generated-component-code PASS: modules=${scan.directModules.length} dist=${scan.boundary.distRel}`,
);

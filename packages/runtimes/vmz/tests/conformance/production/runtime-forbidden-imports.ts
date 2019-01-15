/**
 * 0.1.32 — browser closure must not import host decision interpreters.
 * verify id: runtime-forbidden-imports
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertRuntimeForbiddenImports, buildThinProductionFixture } from '../_lib/thin-runtime-production-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`runtime-forbidden-imports FAIL: ${msg}`);
    process.exit(1);
}

console.log('runtime-forbidden-imports: build + assert closure…');
let scan;
try {
    scan = buildThinProductionFixture(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertRuntimeForbiddenImports(scan);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'runtime-forbidden-imports',
    status: 'passed',
    detail: `forbiddenImports=${scan.inventory.forbiddenImports.length}; staticEntry=ok`,
});
addLimitation(proof, '0.1.32: bind*/eachBlock/ifBlock remain Direct platform APIs in dom-core');
writeProof(proof, root);

console.log(`runtime-forbidden-imports PASS: modules=${scan.inventory.browserClosure.modules.length}`);

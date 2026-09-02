/**
 * Forbid @ts-nocheck / @ts-ignore / unbounded @ts-expect-error in @vmz/core runtime src.
 * verify id: no-type-check-suppression
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { scanTypeCheckSuppression } from '../_lib/source-lint-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`no-type-check-suppression FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-type-check-suppression: scan vmz-runtime/src…');
const errors = scanTypeCheckSuppression(root);
if (errors.length) fail(errors.slice(0, 12).join('; ') + (errors.length > 12 ? ` (+${errors.length - 12} more)` : ''));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'no-type-check-suppression',
    status: 'passed',
    detail: 'vmz-runtime/src has no type-check suppression directives',
});
writeProof(proof, root);

console.log('no-type-check-suppression PASS');

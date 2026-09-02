/**
 * @vmz/core src must split browser / ssr / host / faces / shared.
 * verify id: package-layout-core
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { assertPackageLayoutCore } from '../_lib/package-layout-gate.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`package-layout-core FAIL: ${msg}`);
    process.exit(1);
}

console.log('package-layout-core: assert @vmz/core src layers…');
const errors = assertPackageLayoutCore(root);
if (errors.length) fail(errors.slice(0, 12).join('; ') + (errors.length > 12 ? ` (+${errors.length - 12} more)` : ''));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'package-layout-core',
    status: 'passed',
    detail: 'browser/ssr/host/faces/shared present; no stray root .ts',
});
writeProof(proof, root);

console.log('package-layout-core PASS');

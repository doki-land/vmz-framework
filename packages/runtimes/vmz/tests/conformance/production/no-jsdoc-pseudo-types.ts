/**
 * Forbid JSDoc @param/@returns/@type/@typedef brace annotations in @vmz/core runtime src.
 * verify id: no-jsdoc-pseudo-types
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { scanJSDocPseudoTypes } from '../_lib/source-lint-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`no-jsdoc-pseudo-types FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-jsdoc-pseudo-types: scan vmz-runtime/src…');
const errors = scanJSDocPseudoTypes(root);
if (errors.length) fail(errors.slice(0, 12).join('; ') + (errors.length > 12 ? ` (+${errors.length - 12} more)` : ''));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'no-jsdoc-pseudo-types',
    status: 'passed',
    detail: 'vmz-runtime/src uses TypeScript types instead of JSDoc pseudo-types',
});
writeProof(proof, root);

console.log('no-jsdoc-pseudo-types PASS');

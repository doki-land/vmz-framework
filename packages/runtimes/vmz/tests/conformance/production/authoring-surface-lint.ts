/**
 * Official UI / homepage / examples must not teach explicit this.method in templates.
 * verify id: authoring-surface-lint
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { scanAuthoringSurface } from '../_lib/source-lint-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`authoring-surface-lint FAIL: ${msg}`);
    process.exit(1);
}

console.log('authoring-surface-lint: scan official .vmz templates…');
const errors = scanAuthoringSurface(root);
if (errors.length) fail(errors.slice(0, 12).join('; ') + (errors.length > 12 ? ` (+${errors.length - 12} more)` : ''));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'authoring-surface-lint',
    status: 'passed',
    detail: 'no explicit this.method handlers in official template surfaces',
});
writeProof(proof, root);

console.log('authoring-surface-lint PASS');

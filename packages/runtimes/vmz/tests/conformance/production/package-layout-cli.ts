/**
 * vmz CLI src must use domain folders; index.ts must stay thin.
 * verify id: package-layout-cli
 */

import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { assertPackageLayoutCli } from '../_lib/package-layout-gate.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`package-layout-cli FAIL: ${msg}`);
    process.exit(1);
}

console.log('package-layout-cli: assert vmz CLI src domains…');
const errors = assertPackageLayoutCli(root);
if (errors.length) fail(errors.slice(0, 12).join('; ') + (errors.length > 12 ? ` (+${errors.length - 12} more)` : ''));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'package-layout-cli',
    status: 'passed',
    detail: 'cli/workspace/document/locale/delivery/dev/host-materialize; thin index',
});
writeProof(proof, root);

console.log('package-layout-cli PASS');

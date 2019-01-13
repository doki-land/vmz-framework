/**
 * 0.1.28 — browser import closure must not pull Node/host blacklist.
 * verify id: runtime-boundary-audit
 */

import path from 'node:path';
import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import type { RuntimeInventory } from '../_lib/runtime-inventory.ts';
import { assertBoundaryAudit, buildAndRecordInventory } from '../_lib/runtime-inventory-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`runtime-boundary-audit FAIL: ${msg}`);
    process.exit(1);
}

console.log('runtime-boundary-audit: build + audit closure…');
let inventory: RuntimeInventory;
try {
    ({ inventory } = buildAndRecordInventory(root));
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertBoundaryAudit(inventory);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
upsertCheck(proof, {
    id: 'runtime-boundary-audit',
    status: 'passed',
    detail: `entry=${inventory.browserClosure.entry}; modules=${inventory.browserClosure.modules.length}; hostOutDirOnly=${inventory.hostInOutDirNotInClosure.length}; forbidden=${inventory.forbiddenImports.length}`,
});
writeProof(proof, root);

console.log(
    `runtime-boundary-audit PASS: entry=${inventory.browserClosure.entry} modules=${inventory.browserClosure.modules.length} hostOutDirOnly=${inventory.hostInOutDirNotInClosure.length}`,
);
console.log(`runtime-boundary-audit NOTE: inventory=${path.relative(root, path.join(root, 'dist', 'vmz.runtime-inventory.json'))}`);

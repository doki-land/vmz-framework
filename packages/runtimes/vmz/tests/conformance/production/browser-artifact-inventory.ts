/**
 * 0.1.28 — owner matrix + inventory JSON.
 * verify id: browser-artifact-inventory
 */

import fs from 'node:fs';
import path from 'node:path';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { RUNTIME_INVENTORY_SCHEMA, type RuntimeInventory } from '../_lib/runtime-inventory.ts';
import { assertInventoryContract, buildAndRecordInventory, inventoryPath } from '../_lib/runtime-inventory-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`browser-artifact-inventory FAIL: ${msg}`);
    process.exit(1);
}

console.log('browser-artifact-inventory: build + record…');
let inventory: RuntimeInventory;
try {
    ({ inventory } = buildAndRecordInventory(root));
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const outPath = inventoryPath(root);
if (!fs.existsSync(outPath)) fail(`missing ${path.relative(root, outPath)}`);
if (inventory.schema !== RUNTIME_INVENTORY_SCHEMA) fail('schema mismatch');

const errors = assertInventoryContract(inventory);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
proof.hostProfile = proof.hostProfile ?? 'browser-web-surface';
proof.deliveryProfile = proof.deliveryProfile ?? 'browser-ssr-direct-resume';
proof.runtimeInventoryPath = path.relative(root, outPath).replace(/\\/g, '/');
upsertCheck(proof, {
    id: 'browser-artifact-inventory',
    status: 'passed',
    detail: `owners=${inventory.owners.length}; closure=${inventory.browserClosure.modules.length}; out=${path.relative(root, outPath).replace(/\\/g, '/')}`,
});
addLimitation(proof, '0.1.28: inventory records interpreter owners; specialized emit remains 0.1.29; thin runtime 0.1.32');
writeProof(proof, root);

console.log(
    `browser-artifact-inventory PASS: ${path.relative(root, outPath)} owners=${inventory.owners.length} debt=${inventory.owners.map((o) => `${o.id}->${o.debtTarget}`).join('|')}`,
);
console.log('browser-artifact-inventory NOTE: does not claim thin runtime or specialized component artifact');

/**
 * 0.1.28 — record runtime budget baseline (no hard size fail).
 * verify id: runtime-budget-baseline
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import type { RuntimeInventory } from '../_lib/runtime-inventory.ts';
import { assertBudgetBaseline, buildAndRecordInventory } from '../_lib/runtime-inventory-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`runtime-budget-baseline FAIL: ${msg}`);
    process.exit(1);
}

console.log('runtime-budget-baseline: build + record budget…');
let inventory: RuntimeInventory;
try {
    ({ inventory } = buildAndRecordInventory(root));
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertBudgetBaseline(inventory);
if (errors.length) fail(errors.join('; '));

const b = inventory.budget;
const proof = readProof(root);
upsertCheck(proof, {
    id: 'runtime-budget-baseline',
    status: 'passed',
    detail: `generated=${b.generatedBytes}; runtimeShared=${b.runtimeSharedBytes}; closure=${b.browserClosureBytes}; ratio=${b.ratioRuntimeToGenerated}; hostSuspect=${b.hostOrNodeSuspectBytes}`,
});
addLimitation(proof, `0.1.28: budget baseline only (ratioRuntimeToGenerated=${b.ratioRuntimeToGenerated}); hard size gate is 0.1.32`);
writeProof(proof, root);

console.log(
    `runtime-budget-baseline PASS: generated=${b.generatedBytes} runtimeShared=${b.runtimeSharedBytes} closure=${b.browserClosureBytes} ratio=${b.ratioRuntimeToGenerated}`,
);
console.log('runtime-budget-baseline NOTE: no hard size fail; thin claim remains false; out=dist/vmz.runtime-inventory.json');

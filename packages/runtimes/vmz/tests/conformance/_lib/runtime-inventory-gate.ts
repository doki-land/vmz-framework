/**
 * Shared build + inventory record for 0.1.28 gates.
 */

import { runVmzBuild } from './production-proof.ts';
import { repoRoot } from './repo-root.ts';
import {
    assertBoundaryAudit,
    assertBudgetBaseline,
    assertInventoryContract,
    inventoryPath,
    type RuntimeInventory,
    recordRuntimeInventory,
} from './runtime-inventory.ts';

export const INVENTORY_FIXTURE = 'packages/examples/production-catalog';

export function buildAndRecordInventory(root = repoRoot(import.meta.url)): {
    inventory: RuntimeInventory;
    dist: string;
    outPath: string;
} {
    const build = runVmzBuild(INVENTORY_FIXTURE, root);
    if (build.status !== 0) {
        throw new Error(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
    }
    const inventory = recordRuntimeInventory({
        root,
        fixtureRel: INVENTORY_FIXTURE,
        profileId: 'web-ssr',
        distDir: build.dist,
    });
    return { inventory, dist: build.dist, outPath: inventoryPath(root) };
}

export { assertBoundaryAudit, assertBudgetBaseline, assertInventoryContract, inventoryPath };

/**
 * 0.1.30 — compiled `_vmz/route-catalog.json`.
 * verify id: compiled-route-artifact
 */

import { assertCompiledRouteArtifact, buildCompiledDelivery, type CompiledDeliveryScan } from '../_lib/compiled-delivery-gate.ts';

function fail(msg: string): never {
    console.error(`compiled-route-artifact FAIL: ${msg}`);
    process.exit(1);
}

console.log('compiled-route-artifact: build + assert route-catalog…');
let scan: CompiledDeliveryScan;
try {
    scan = buildCompiledDelivery();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertCompiledRouteArtifact(scan);
if (errors.length) fail(errors.join('; '));
console.log(`compiled-route-artifact PASS: pages=${(scan.routeCatalog?.pages as unknown[])?.length ?? 0}`);

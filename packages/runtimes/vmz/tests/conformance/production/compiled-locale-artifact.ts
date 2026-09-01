/**
 * 0.1.30 — locale realization + `_vmz/locale-link-plan.json`.
 * verify id: compiled-locale-artifact
 */

import { assertCompiledLocaleArtifact, buildCompiledDelivery, type CompiledDeliveryScan } from '../_lib/compiled-delivery-gate.ts';

function fail(msg: string): never {
    console.error(`compiled-locale-artifact FAIL: ${msg}`);
    process.exit(1);
}

console.log('compiled-locale-artifact: build + assert locale link plan…');
let scan: CompiledDeliveryScan;
try {
    scan = buildCompiledDelivery();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertCompiledLocaleArtifact(scan);
if (errors.length) fail(errors.join('; '));
console.log(`compiled-locale-artifact PASS: rows=${(scan.localeLinkPlan?.rows as unknown[])?.length ?? 0}`);

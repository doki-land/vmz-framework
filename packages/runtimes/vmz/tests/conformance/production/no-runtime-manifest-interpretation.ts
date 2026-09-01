/**
 * 0.1.30 — hosts/client consume frozen catalog/hrefs (no live deployment / path-prefix algebra authority).
 * verify id: no-runtime-manifest-interpretation
 */

import { assertNoRuntimeManifestInterpretation, buildCompiledDelivery } from '../_lib/compiled-delivery-gate.ts';

function fail(msg: string): never {
    console.error(`no-runtime-manifest-interpretation FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-runtime-manifest-interpretation: build + assert host/client contracts…');
let scan;
try {
    scan = buildCompiledDelivery();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertNoRuntimeManifestInterpretation(scan);
if (errors.length) fail(errors.join('; '));
console.log('no-runtime-manifest-interpretation PASS');

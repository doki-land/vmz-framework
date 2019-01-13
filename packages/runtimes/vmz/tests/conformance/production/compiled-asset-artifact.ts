/**
 * 0.1.30 — asset-plan + content-addressed with rewrittenHtml: 0.
 * verify id: compiled-asset-artifact
 */

import { assertCompiledAssetArtifact, buildCompiledDelivery, type CompiledDeliveryScan } from '../_lib/compiled-delivery-gate.ts';

function fail(msg: string): never {
    console.error(`compiled-asset-artifact FAIL: ${msg}`);
    process.exit(1);
}

console.log('compiled-asset-artifact: build + assert asset plan…');
let scan: CompiledDeliveryScan;
try {
    scan = buildCompiledDelivery();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertCompiledAssetArtifact(scan);
if (errors.length) fail(errors.join('; '));
console.log(`compiled-asset-artifact PASS: rewrittenHtml=${String(scan.contentAddressed?.rewrittenHtml)}`);

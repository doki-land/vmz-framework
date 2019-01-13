/**
 * 0.1.30 — forbid post-hash HTML semantic rewrite (rewrittenHtml: 0 + plan-row apply).
 * verify id: no-post-emit-semantic-rewrite
 */

import { assertNoPostEmitSemanticRewrite, buildCompiledDelivery } from '../_lib/compiled-delivery-gate.ts';

function fail(msg: string): never {
    console.error(`no-post-emit-semantic-rewrite FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-post-emit-semantic-rewrite: build + assert rewrite ban…');
let scan;
try {
    scan = buildCompiledDelivery();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertNoPostEmitSemanticRewrite(scan);
if (errors.length) fail(errors.join('; '));
console.log('no-post-emit-semantic-rewrite PASS');

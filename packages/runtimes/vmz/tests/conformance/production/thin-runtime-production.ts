/**
 * 0.1.32 — thinRuntimeClaim + entry without registry + owner flip.
 * verify id: thin-runtime-production
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertThinRuntimeProduction, buildThinProductionFixture } from '../_lib/thin-runtime-production-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`thin-runtime-production FAIL: ${msg}`);
    process.exit(1);
}

console.log('thin-runtime-production: build + assert claim/owners/entry…');
let scan;
try {
    scan = buildThinProductionFixture(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertThinRuntimeProduction(scan);
if (errors.length) fail(errors.join('; '));

const proof = readProof(root);
proof.thinRuntimeClaim = true;
upsertCheck(proof, {
    id: 'thin-runtime-production',
    status: 'passed',
    detail: `thinRuntimeClaim=true; entry=no-registerComponents; owners=flipped; closure=${scan.inventory.browserClosure.modules.length}`,
});
addLimitation(proof, '0.1.32: thin runtime proof; productionReadyClaim remains false');
writeProof(proof, root);

console.log(
    `thin-runtime-production PASS: thinRuntimeClaim inventory=${scan.inventory.thinRuntimeClaim} entryBytes=${scan.entryClient.length}`,
);

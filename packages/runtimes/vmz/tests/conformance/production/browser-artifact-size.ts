/**
 * 0.1.32 — hard browser closure size + runtime/generated ratio caps.
 * verify id: browser-artifact-size
 */

import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { assertBrowserArtifactSize, buildThinProductionFixture, THIN_RUNTIME_BUDGET } from '../_lib/thin-runtime-production-gate.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`browser-artifact-size FAIL: ${msg}`);
    process.exit(1);
}

console.log('browser-artifact-size: build + assert hard caps…');
let scan;
try {
    scan = buildThinProductionFixture(root);
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const errors = assertBrowserArtifactSize(scan);
if (errors.length) fail(errors.join('; '));

const b = scan.inventory.budget;
const proof = readProof(root);
upsertCheck(proof, {
    id: 'browser-artifact-size',
    status: 'passed',
    detail: `closure=${b.browserClosureBytes}/${THIN_RUNTIME_BUDGET.maxBrowserClosureBytes}; ratio=${b.ratioRuntimeToGenerated}/${THIN_RUNTIME_BUDGET.maxRatioRuntimeToGenerated}`,
});
addLimitation(proof, '0.1.32: hard size gate on browser import closure (not package dir volume)');
writeProof(proof, root);

console.log(`browser-artifact-size PASS: closure=${b.browserClosureBytes} ratio=${b.ratioRuntimeToGenerated}`);

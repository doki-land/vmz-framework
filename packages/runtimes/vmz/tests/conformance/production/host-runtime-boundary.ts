/**
 * 0.1.31 — host companions under `_vmz/host/`, not delivery root.
 * verify id: host-runtime-boundary
 */
import { assertHostRuntimeBoundary, buildThinHostFixture } from '../_lib/thin-runtime-host-gate.ts';

function fail(msg: string): never {
    console.error(`host-runtime-boundary FAIL: ${msg}`);
    process.exit(1);
}

console.log('host-runtime-boundary: build + assert `_vmz/host` nest…');
let scan;
try {
    scan = buildThinHostFixture();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertHostRuntimeBoundary(scan);
if (errors.length) fail(errors.join('; '));
console.log(`host-runtime-boundary PASS: hostFiles=${scan.hostDirFiles.length}`);

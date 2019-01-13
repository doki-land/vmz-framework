/**
 * 0.1.31 — browser must not invent reload/plan dispatch.
 * verify id: no-browser-plan-dispatch
 */
import { assertNoBrowserPlanDispatch, buildThinHostFixture } from '../_lib/thin-runtime-host-gate.ts';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`no-browser-plan-dispatch FAIL: ${msg}`);
    process.exit(1);
}

console.log('no-browser-plan-dispatch: build + assert contracts…');
let scan;
try {
    scan = buildThinHostFixture();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertNoBrowserPlanDispatch(repoRoot(import.meta.url), scan);
if (errors.length) fail(errors.join('; '));
console.log('no-browser-plan-dispatch PASS');

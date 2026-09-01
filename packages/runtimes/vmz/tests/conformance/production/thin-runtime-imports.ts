/**
 * 0.1.31 — browser thin import face (dom.browser / dom-core).
 * verify id: thin-runtime-imports
 */
import { assertThinRuntimeImports, buildThinHostFixture } from '../_lib/thin-runtime-host-gate.ts';

function fail(msg: string): never {
    console.error(`thin-runtime-imports FAIL: ${msg}`);
    process.exit(1);
}

console.log('thin-runtime-imports: build + assert thin faces…');
let scan;
try {
    scan = buildThinHostFixture();
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const errors = assertThinRuntimeImports(scan);
if (errors.length) fail(errors.join('; '));
console.log('thin-runtime-imports PASS');

/**
 * 0.1.31 — outputRevision + payload is the sole reload decision owner.
 * verify id: single-revision-owner
 */
import { assertSingleRevisionOwner } from '../_lib/thin-runtime-host-gate.ts';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`single-revision-owner FAIL: ${msg}`);
    process.exit(1);
}

console.log('single-revision-owner: assert payload-only serve-host…');
const errors = assertSingleRevisionOwner(repoRoot(import.meta.url));
if (errors.length) fail(errors.join('; '));
console.log('single-revision-owner PASS');

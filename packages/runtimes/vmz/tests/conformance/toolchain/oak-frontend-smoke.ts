/**
 * Oak Vue CST adapter smoke — VMZ region map + template CST parse.
 * verify id: oak-frontend-smoke
 */

import { spawnSync } from 'node:child_process';
import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`oak-frontend-smoke FAIL: ${msg}`);
    process.exit(1);
}

console.log('oak-frontend-smoke: cargo test vmz-oak-frontend-adapter…');
const run = spawnSync('cargo', ['test', '-p', 'vmz-oak-frontend-adapter', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
});
if (run.status !== 0) {
    console.error(run.stdout || '');
    console.error(run.stderr || '');
    fail('cargo test -p vmz-oak-frontend-adapter');
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'oak-frontend-smoke',
    status: 'passed',
    detail: 'vmz-oak-frontend-adapter region map + Oak Vue CST template parse',
});
writeProof(proof, root);

console.log('oak-frontend-smoke PASS');

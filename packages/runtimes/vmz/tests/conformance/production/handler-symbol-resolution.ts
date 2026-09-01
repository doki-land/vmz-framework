/**
 * Bare class method handlers resolve at compile time; unknown idents fail closed.
 * verify id: handler-symbol-resolution
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`handler-symbol-resolution FAIL: ${msg}`);
    process.exit(1);
}

function cargoFilter(filter: string) {
    const run = spawnSync('cargo', ['test', '-p', 'vmz-compiler', '--test', 'pipeline_emit_unit', filter, '--quiet'], {
        cwd: root,
        encoding: 'utf8',
        shell: true,
    });
    if (run.status !== 0) {
        console.error(run.stdout || '');
        console.error(run.stderr || '');
        fail(`cargo test ${filter}`);
    }
}

console.log('handler-symbol-resolution: bare class method → this.method…');
cargoFilter('resolves_bare_class_method');
console.log('handler-symbol-resolution: unresolved bare handler fails compile…');
cargoFilter('rejects_unresolved_bare_handler');
console.log('handler-symbol-resolution: component @event bare method…');
cargoFilter('resolves_bare_method_on_component_event');

const proof = readProof(root);
upsertCheck(proof, {
    id: 'handler-symbol-resolution',
    status: 'passed',
    detail: 'pipeline_emit_unit bare method scope + compile-time reject',
});
addLimitation(proof, 'handler resolution is compile-time only, not runtime string guess');
writeProof(proof, root);

console.log('handler-symbol-resolution PASS');
console.log(`handler-symbol-resolution NOTE: does not claim thin runtime (${path.relative(root, 'dist/vmz.runtime-inventory.json')})`);

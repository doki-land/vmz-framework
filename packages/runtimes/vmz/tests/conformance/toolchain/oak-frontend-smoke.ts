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
const adapterRun = spawnSync('cargo', ['test', '-p', 'vmz-oak-frontend-adapter', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
});
if (adapterRun.status !== 0) {
    console.error(adapterRun.stdout || '');
    console.error(adapterRun.stderr || '');
    fail('cargo test -p vmz-oak-frontend-adapter');
}

console.log('oak-frontend-smoke: cargo test vmz-compiler oak + nyar + vue-oak-surface…');
const compilerRun = spawnSync(
    'cargo',
    [
        'test',
        '-p',
        'vmz-compiler',
        '--test',
        'oak_template_unit',
        '--test',
        'nyar_projection_unit',
        '--test',
        'template_vue_oak_surface_unit',
        '--quiet',
    ],
    {
        cwd: root,
        encoding: 'utf8',
        shell: true,
    },
);
if (compilerRun.status !== 0) {
    console.error(compilerRun.stdout || '');
    console.error(compilerRun.stderr || '');
    fail('cargo test -p vmz-compiler oak_template_unit nyar_projection_unit template_vue_oak_surface_unit');
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'oak-frontend-smoke',
    status: 'passed',
    detail: 'Oak CST/AST adapter, script TS AST, concrete/semantic layers, vue-oak-surface matrix, Nyar projection stub',
});
writeProof(proof, root);

console.log('oak-frontend-smoke PASS');

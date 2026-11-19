/**
 * `data.text` Vue CST adapter smoke — VMZ region map + template CST parse.
 * verify id: text-frontend-smoke
 */

import { spawnSync } from 'node:child_process';
import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`text-frontend-smoke FAIL: ${msg}`);
    process.exit(1);
}

console.log('text-frontend-smoke: cargo test vmz-text-frontend-adapter…');
const adapterRun = spawnSync('cargo', ['test', '-p', 'vmz-text-frontend-adapter', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
});
if (adapterRun.status !== 0) {
    console.error(adapterRun.stdout || '');
    console.error(adapterRun.stderr || '');
    fail('cargo test -p vmz-text-frontend-adapter');
}

console.log('text-frontend-smoke: cargo test vmz-compiler text + nyar + text-frontend-surface…');
const compilerRun = spawnSync(
    'cargo',
    [
        'test',
        '-p',
        'vmz-compiler',
        '--test',
        'text_template_unit',
        '--test',
        'nyar_projection_unit',
        '--test',
        'template_vue_surface_unit',
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
    fail('cargo test -p vmz-compiler text_template_unit nyar_projection_unit template_vue_surface_unit');
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'text-frontend-smoke',
    status: 'passed',
    detail: '`data.text` CST/AST adapter, script TS AST, concrete/semantic layers, text-frontend-surface matrix, Nyar projection stub',
});
writeProof(proof, root);

console.log('text-frontend-smoke PASS');

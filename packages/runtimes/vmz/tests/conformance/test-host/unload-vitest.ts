/**
 * test-host: unload Vitest from fullstack / vmz / textmate + root.
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { spawnSync } from 'node:child_process';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function pkgHasVitest(pkgPath) {
    const pkg = readJson(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    return Object.keys(deps).some((k) => k === 'vitest' || k.startsWith('vitest/'));
}

function pnpmFilter(filter, script) {
    const r = spawnSync('pnpm', ['--filter', filter, 'run', script], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
    });
    if (r.status !== 0) {
        fail(`${filter} ${script} failed\n${r.stdout}\n${r.stderr}`);
    }
}

const targets = [
    ['counter', 'packages/examples/counter/package.json'],
    ['island', 'packages/examples/island/package.json'],
    ['fullstack', 'packages/examples/fullstack/package.json'],
    ['@vmz/vmz', 'packages/runtimes/vmz/package.json'],
    ['vmz-textmate', 'packages/editors/vmz-textmate/package.json'],
    ['root', 'package.json'],
];

console.log(': assert no vitest dependency…');
for (const [name, rel] of targets) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) fail(`missing ${rel}`);
    if (pkgHasVitest(abs)) fail(`${name} still depends on vitest (${rel})`);
}

for (const rel of [
    'packages/examples/fullstack/vitest.config.ts',
    'packages/runtimes/vmz/vitest.config.ts',
    'packages/editors/vmz-textmate/vitest.config.ts',
]) {
    if (fs.existsSync(path.join(root, rel))) fail(`banned file exists: ${rel}`);
}

console.log(': vmz-textmate node:test…');
pnpmFilter('vmz-textmate', 'test');

console.log(': @vmz/vmz package node:test…');
pnpmFilter('@vmz/vmz', 'test');

console.log(': counter + island vmz test…');
pnpmFilter('@vmz-examples/counter', 'test');
pnpmFilter('@vmz-examples/island', 'test');

console.log(': fullstack vmz test + node host/SSR…');
pnpmFilter('@vmz-examples/fullstack', 'test');

console.log(' GATE OK: Vitest unloaded from counter/island/fullstack/@vmz/vmz/textmate + root');

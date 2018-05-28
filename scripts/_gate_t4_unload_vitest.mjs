/**
 * T4 gate: unload Vitest from fullstack / vmz / textmate + root.
 *
 * Design: 规划设计/vmz/16 §6 T4
 * Usage: pnpm gate:t4
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
    console.error(`T4 GATE FAIL: ${msg}`);
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
    ['vmz', 'packages/runtimes/vmz/package.json'],
    ['vmz-textmate', 'packages/editors/vmz-textmate/package.json'],
    ['root', 'package.json'],
];

console.log('T4: assert no vitest dependency…');
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

console.log('T4: vmz-textmate node:test…');
pnpmFilter('vmz-textmate', 'test');

console.log('T4: vmz package node:test…');
pnpmFilter('vmz', 'test');

console.log('T4: counter + island vmz test…');
pnpmFilter('@vmz-examples/counter', 'test');
pnpmFilter('@vmz-examples/island', 'test');

console.log('T4: fullstack vmz test + node host/SSR…');
pnpmFilter('@vmz-examples/fullstack', 'test');

console.log('T4 GATE OK: Vitest unloaded from counter/island/fullstack/vmz/textmate + root');

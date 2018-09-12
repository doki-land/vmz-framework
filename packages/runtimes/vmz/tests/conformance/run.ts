#!/usr/bin/env node
/**
 * Conformance runner for packages/runtimes/vmz/tests/conformance.
 *
 * pnpm verify -- program-ir
 * pnpm --filter vmz run verify -- --list
 *
 * Drivers are TypeScript under domain folders (toolchain/, native/, …).
 * Root `scripts/` is build/CI only — not the home for conformance logic.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { repoRoot } from './_lib/repo-root.ts';
import { CHECK_ALL, CHECKS, type CheckEntry } from './registry.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = repoRoot(import.meta.url);
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;

const PRESETS: Record<string, [string, string[]]> = {
    'build:runtimes': ['pnpm', ['build:runtimes']],
    'build:plugin-shiki': ['pnpm', ['--filter', '@vmz/plugin-shiki', 'run', 'build']],
    'build:vmz-test': ['pnpm', ['build:vmz-test']],
    'build:protocol-vmz': ['pnpm', ['--filter', '@vmz/protocol', '--filter', 'vmz', 'run', 'build']],
};

function fail(msg: string): never {
    console.error(`verify: ${msg}`);
    process.exit(1);
}

function runPre(preId: string) {
    const spec = PRESETS[preId];
    if (!spec) fail(`unknown pre step: ${preId}`);
    const [cmd, args] = spec;
    console.log(`» pre ${preId}`);
    const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    if (r.status !== 0) fail(`pre ${preId} exited ${r.status}`);
}

function runCheck(id: string, stack: string[] = [], ranPre: Set<string> = new Set()) {
    if (stack.includes(id)) fail(`composite cycle: ${[...stack, id].join(' → ')}`);
    const entry = CHECKS[id] as CheckEntry | undefined;
    if (!entry) {
        fail(`unknown check '${id}'. Try: pnpm verify -- --list`);
    }

    if (entry.pre) {
        for (const p of entry.pre) {
            if (ranPre.has(p)) continue;
            runPre(p);
            ranPre.add(p);
        }
    }

    if ('composite' in entry) {
        console.log(`» suite ${id}${entry.description ? ` — ${entry.description}` : ''}`);
        for (const child of entry.composite) {
            runCheck(child, [...stack, id], ranPre);
        }
        console.log(`✓ suite ${id}`);
        return;
    }

    const file = path.join(here, entry.file);
    console.log(`» ${id} (${entry.file})`);
    const r = spawnSync(process.execPath, ['--import', resolveHook, '--experimental-strip-types', file], {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
    });
    if (r.status !== 0) fail(`${id} exited ${r.status}`);
    console.log(`✓ ${id}`);
}

function list() {
    const ids = Object.keys(CHECKS).sort();
    for (const id of ids) {
        const e = CHECKS[id];
        const kind = 'composite' in e ? 'suite' : 'check';
        const desc = e.description ? ` — ${e.description}` : '';
        console.log(`${id.padEnd(28)} ${kind}${desc}`);
    }
    console.log(`\n${ids.length} ids. Default suite: ${CHECK_ALL.length} checks (pnpm verify).`);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length === 0 || args[0] === '--all') {
    for (const id of CHECK_ALL) runCheck(id);
    console.log(`\nverify: all ${CHECK_ALL.length} checks passed`);
    process.exit(0);
}
if (args[0] === '--list' || args[0] === '-l') {
    list();
    process.exit(0);
}
if (args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  pnpm verify -- --list
  pnpm verify -- --all
  pnpm verify -- <id> [<id>...]
`);
    process.exit(0);
}

for (const id of args) runCheck(id);
console.log(`\nverify: ${args.join(', ')} passed`);

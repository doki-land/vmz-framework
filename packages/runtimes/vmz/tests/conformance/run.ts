#!/usr/bin/env node
/**
 * Conformance runner for packages/runtimes/vmz/tests/conformance.
 *
 * pnpm verify -- program-ir
 * pnpm verify -- --keep-going runtime-quality-baseline
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
    // When CI restored a runtime artifact, skip cargo/napi (VMZ_SKIP_NATIVE_BUILD=1).
    'build:runtimes':
        process.env.VMZ_SKIP_NATIVE_BUILD === '1'
            ? ['node', ['-e', "console.log('verify: pre build:runtimes skipped (VMZ_SKIP_NATIVE_BUILD=1)')"]]
            : ['pnpm', ['build:runtimes']],
    'build:plugin-shiki': ['pnpm', ['--filter', '@vmz/plugin-shiki', 'run', 'build']],
    'build:vmz-test': ['pnpm', ['build:vmz-test']],
    'build:protocol-vmz':
        process.env.VMZ_SKIP_NATIVE_BUILD === '1'
            ? ['pnpm', ['--filter', '@vmz/protocol', 'run', 'build']]
            : ['pnpm', ['--filter', '@vmz/protocol', '--filter', 'vmz', 'run', 'build']],
    'build:content-engines': [
        'pnpm',
        [
            '--filter',
            '@vmz/highlighter',
            '--filter',
            '@vmz/highlighter-unknown-wasm32',
            '--filter',
            '@vmz/markdown',
            '--filter',
            '@vmz/markdown-unknown-wasm32',
            '--filter',
            '@vmz/plugin-syntect',
            'run',
            'build',
        ],
    ],
};

type RunOpts = {
    keepGoing: boolean;
    failures: string[];
};

function failHard(msg: string): never {
    console.error(`verify: ${msg}`);
    process.exit(1);
}

function noteFailure(opts: RunOpts, msg: string) {
    opts.failures.push(msg);
    console.error(`✗ ${msg}`);
}

function runPre(preId: string, opts: RunOpts): boolean {
    const spec = PRESETS[preId];
    if (!spec) failHard(`unknown pre step: ${preId}`);
    const [cmd, args] = spec;
    console.log(`» pre ${preId}`);
    const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    if (r.status === 0) return true;
    const msg = `pre ${preId} exited ${r.status}`;
    if (opts.keepGoing) {
        noteFailure(opts, msg);
        return false;
    }
    failHard(msg);
}

function runCheck(id: string, opts: RunOpts, stack: string[] = [], ranPre: Set<string> = new Set()) {
    if (stack.includes(id)) failHard(`composite cycle: ${[...stack, id].join(' → ')}`);
    const entry = CHECKS[id] as CheckEntry | undefined;
    if (!entry) {
        failHard(`unknown check '${id}'. Try: pnpm verify -- --list`);
    }

    if (entry.pre) {
        for (const p of entry.pre) {
            if (ranPre.has(p)) continue;
            const ok = runPre(p, opts);
            if (!ok) {
                // Keep siblings runnable; skip this check's body when its pre failed.
                noteFailure(opts, `${id} skipped (pre ${p} failed)`);
                return;
            }
            ranPre.add(p);
        }
    }

    if ('composite' in entry) {
        console.log(`» suite ${id}${entry.description ? ` — ${entry.description}` : ''}`);
        const before = opts.failures.length;
        for (const child of entry.composite) {
            runCheck(child, opts, [...stack, id], ranPre);
        }
        if (opts.failures.length > before) {
            console.error(`✗ suite ${id} (${opts.failures.length - before} failure(s))`);
        } else {
            console.log(`✓ suite ${id}`);
        }
        return;
    }

    const file = path.join(here, entry.file);
    console.log(`» ${id} (${entry.file})`);
    const r = spawnSync(process.execPath, ['--import', resolveHook, '--experimental-strip-types', file], {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
    });
    if (r.status !== 0) {
        const msg = `${id} exited ${r.status}`;
        if (opts.keepGoing) {
            noteFailure(opts, msg);
            return;
        }
        failHard(msg);
    }
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

function parseArgs(argv: string[]) {
    const keepGoing = argv.includes('--keep-going') || argv.includes('-k');
    const rest = argv.filter((a) => a !== '--' && a !== '--keep-going' && a !== '-k');
    return { keepGoing, rest };
}

function finish(opts: RunOpts, label: string) {
    if (opts.failures.length) {
        console.error(`\nverify: ${opts.failures.length} failure(s) under ${label}:`);
        for (const f of opts.failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(`\nverify: ${label} passed`);
    process.exit(0);
}

const { keepGoing, rest: args } = parseArgs(process.argv.slice(2));
const opts: RunOpts = { keepGoing, failures: [] };

if (args.length === 0 || args[0] === '--all') {
    for (const id of CHECK_ALL) runCheck(id, opts);
    finish(opts, `all ${CHECK_ALL.length} checks`);
}
if (args[0] === '--list' || args[0] === '-l') {
    list();
    process.exit(0);
}
if (args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  pnpm verify -- --list
  pnpm verify -- --all
  pnpm verify -- [--keep-going|-k] <id> [<id>...]

  --keep-going, -k   Run remaining checks after a failure; exit 1 at the end with a summary.
                     Default remains fail-fast (first non-zero exits immediately).
`);
    process.exit(0);
}

for (const id of args) runCheck(id, opts);
finish(opts, args.join(', '));

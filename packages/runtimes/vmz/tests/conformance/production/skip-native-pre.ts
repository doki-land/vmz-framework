/**
 * skip-native-pre — CI artifact consumers must short-circuit `pre: build:runtimes`
 * without spawning a shell no-op. Linux `/bin/sh` rejects `node -e` strings that
 * contain parentheses when `spawnSync(..., { shell: true })` concatenates args.
 *
 * verify id: skip-native-pre (not in CHECK_ALL; wired from CI after artifact restore)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const runTs = path.join(here, '..', 'run.ts');
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;

function fail(msg: string): never {
    console.error(`skip-native-pre GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('skip-native-pre: spawn probe under VMZ_SKIP_NATIVE_BUILD=1…');

const child = spawnSync(
    process.execPath,
    ['--import', resolveHook, '--experimental-strip-types', runTs, '--', 'skip-native-pre-probe'],
    {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, VMZ_SKIP_NATIVE_BUILD: '1' },
    },
);

const out = `${child.stdout ?? ''}${child.stderr ?? ''}`;
if (child.status !== 0) {
    fail(`probe exited ${child.status}\n${out}`);
}

const skipMark = 'pre build:runtimes: skipped (VMZ_SKIP_NATIVE_BUILD=1';
if (!out.includes(skipMark)) {
    fail(`stdout missing skip mark ${JSON.stringify(skipMark)}\n${out}`);
}

if (/Syntax error:.*\(/.test(out)) {
    fail(`shell syntax error in skip path (do not use node -e no-op under shell:true)\n${out}`);
}

// Fail-fast if skip regressed to actually invoking the pnpm preset line.
if (/» pre build:runtimes\n/.test(out) && !out.includes(skipMark)) {
    fail('spawned real pre build:runtimes instead of short-circuit');
}

if (!out.includes('skip-native-pre-probe PASS')) {
    fail(`probe body did not run\n${out}`);
}

console.log('skip-native-pre PASS: build:runtimes short-circuits under VMZ_SKIP_NATIVE_BUILD=1');

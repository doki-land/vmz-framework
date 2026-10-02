/**
 * P0 clean-build alignment — local evidence runner for CI parity.
 *
 * Records toolchain + git SHA, builds runtimes from source (no sibling patch),
 * then runs bounded Rust regression gates that must pass before format-door work.
 *
 * Usage:
 *   node scripts/ci/verify-clean-build.mjs
 *   node scripts/ci/verify-clean-build.mjs --skip-build
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skipBuild = process.argv.includes('--skip-build');

function run(cmd, args, opts = {}) {
    console.log(`\n> ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        ...opts,
    });
    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

function read(cmd, args) {
    const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true });
    return (result.stdout ?? '').trim();
}

console.log('verify-clean-build: recording baseline');
console.log(`HEAD ${read('git', ['rev-parse', 'HEAD'])}`);
console.log(`node ${read('node', ['-v'])}`);
console.log(`rustc ${read('rustc', ['-V'])}`);

if (!skipBuild) {
    run('pnpm', ['build:runtimes']);
    run('node', ['scripts/ci/assert-vmz-pack.mjs']);
} else {
    run('pnpm', ['napi:build']);
}

run('cargo', [
    'test',
    '-p',
    'vmz-formatter',
    '--lib',
    'aria_invalid_ternary',
    '--',
    '--nocapture',
]);
run('cargo', [
    'test',
    '-p',
    'vmz-generator',
    'oak_parses_ternary',
    '--',
    '--nocapture',
]);
run('cargo', [
    'test',
    '-p',
    'vmz-compiler',
    '--test',
    'event_shell_check_unit',
    '--',
    '--nocapture',
]);
run('pnpm', ['fmt:vmz:check']);

console.log('\nverify-clean-build: bounded gates passed');

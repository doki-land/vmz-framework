/**
 * CI parity entrypoints — single command map for local + GitHub Actions.
 *
 * Prerequisite: `pnpm build:runtimes` (CI uploads/restores runtime-build.tar.gz first).
 *
 * Usage:
 *   pnpm verify:ci-skip-native-pre
 *   pnpm verify:ci-runtime-gates
 *   pnpm verify:ci-ui-browser
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PRESETS = {
    'skip-native-pre': ['skip-native-pre'],
    'runtime-gates': [
        '--keep-going',
        'runtime-boundary',
        'specialized-component-artifact',
        'compiled-delivery-artifact',
        'thin-runtime-host-boundary',
        'thin-runtime-production-proof',
        'runtime-quality-baseline',
    ],
    'ui-browser': ['--keep-going', 'ui-automation', 'browser-production'],
};

const id = process.argv[2];
const args = PRESETS[id];
if (!args) {
    console.error(`verify-parity: unknown preset "${id ?? ''}"`);
    console.error(`verify-parity: use one of: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
}

const env = {
    ...process.env,
    VMZ_SKIP_NATIVE_BUILD: '1',
    CI: 'true',
};

console.log(`verify-parity: ${id} (VMZ_SKIP_NATIVE_BUILD=1 CI=true)`);
const run = spawnSync('pnpm', ['verify', '--', ...args], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: true,
});
process.exit(run.status ?? 1);

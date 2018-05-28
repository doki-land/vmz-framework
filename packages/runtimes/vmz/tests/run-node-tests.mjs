/**
 * Run vmz package node:test suite (formerly Vitest).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const resolveHook = pathToFileURL(path.join(root, 'scripts/resolve-ts-from-js.mjs')).href;
const files = ['workspace.test.ts', 'affected.test.ts', 'html-binding.test.ts', 'cli-host.test.ts', 'plugin.test.ts'].map((f) =>
    path.join(here, f),
);

const r = spawnSync(process.execPath, ['--import', resolveHook, '--test', '--experimental-strip-types', ...files], {
    stdio: 'inherit',
    cwd: path.join(here, '..'),
});
process.exit(r.status ?? 1);

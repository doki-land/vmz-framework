/**
 * Run fullstack Node host/SSR unit tests (formerly Vitest).
 * Explicit file list — avoids picking up *.vmz.test.json.
 * Serial concurrency: tests share dist/_vmz_server and ports.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;
const files = [
    'ssr-server.test.ts',
    'host.test.ts',
    'precision.test.ts',
    'path-trie.test.ts',
    'ownership-cf.test.ts',
    'each-batch-race.test.ts',
].map((f) => path.join(here, f));

const r = spawnSync(process.execPath, ['--import', resolveHook, '--test', '--test-concurrency=1', '--experimental-strip-types', ...files], {
    stdio: 'inherit',
    cwd: path.join(here, '..'),
});
process.exit(r.status ?? 1);

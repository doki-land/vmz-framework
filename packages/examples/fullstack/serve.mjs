/**
 * Deprecated: use `vmz serve` (or `pnpm serve`).
 * Kept as a one-liner for muscle memory.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleDist } from '@vmz-examples/test-utils';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = exampleDist('fullstack');
const host = path.join(dist, 'vmz-serve-host.mjs');
const child = spawn(process.execPath, [host], {
    cwd: root,
    env: { ...process.env, VMZ_DIST: dist },
    stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));

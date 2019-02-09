#!/usr/bin/env node
/**
 * Workspace format entry — delegates to `@doki-land/nifty format` (oxc + cargo fmt).
 *
 *   node scripts/format.mjs          # write
 *   node scripts/format.mjs --check  # CI / fmt:check
 *
 * JS style reads `biome.json` formatter keys (nifty-formatter contract).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const r = spawnSync('pnpm', ['exec', 'nifty', 'format', ...(check ? ['--check'] : [])], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (r.error) {
    console.error(r.error);
    process.exit(1);
}
process.exit(r.status ?? 1);

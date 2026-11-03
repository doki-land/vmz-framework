#!/usr/bin/env node
/**
 * Repo format entry — `vmz format` on the explicit repo root with opt-in Rust.
 *
 *   node scripts/format.mjs          # write
 *   node scripts/format.mjs --check  # CI / fmt:check
 *
 * Scope is the explicit `.` path (never an implicit workspace): JS/TS + `.vmz`
 * always, `.rs` via per-file `rustfmt` because of `--rust`. JS style reads
 * `biome.json` formatter keys.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const r = spawnSync('pnpm', ['vmz', 'format', ...(check ? ['--check'] : []), '--rust', '.'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (r.error) {
    console.error(r.error);
    process.exit(1);
}
process.exit(r.status ?? 1);

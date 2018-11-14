#!/usr/bin/env node
/**
 * Shared Biome format entry for local and CI.
 *
 *   node scripts/format.mjs              # write Biome (pnpm fmt default)
 *   node scripts/format.mjs --check      # Biome check (CI / fmt:check)
 *   node scripts/format.mjs --rust       # also cargo fmt (local; needs rustc)
 *   node scripts/format.mjs --check --rust
 *
 * Biome always uses `--diagnostic-level=error` so local write and CI check agree.
 * rustfmt is opt-in: Format Check CI must not install Rust just for this job.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const check = args.includes('--check');
const withRust = args.includes('--rust');
const wantHelp = args.includes('--help') || args.includes('-h');

if (wantHelp) {
    console.log(`format — Biome (± rustfmt)

  node scripts/format.mjs                 write Biome
  node scripts/format.mjs --check         Biome check (CI)
  node scripts/format.mjs --rust          also cargo fmt
  node scripts/format.mjs --check --rust  Biome + rustfmt check
`);
    process.exit(0);
}

function run(cmd, cmdArgs) {
    console.log(`> ${cmd} ${cmdArgs.join(' ')}`);
    const r = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (r.error) {
        console.error(r.error);
        process.exit(1);
    }
    if (r.status !== 0 && r.status != null) {
        process.exit(r.status);
    }
}

const biomeArgs = check
    ? ['exec', 'biome', 'format', '--diagnostic-level=error', '.']
    : ['exec', 'biome', 'format', '--write', '--diagnostic-level=error', '.'];

run('pnpm', biomeArgs);

if (withRust) {
    const cargoArgs = check ? ['fmt', '--all', '--check', '--manifest-path', 'Cargo.toml'] : ['fmt', '--all', '--manifest-path', 'Cargo.toml'];
    run('cargo', cargoArgs);
}

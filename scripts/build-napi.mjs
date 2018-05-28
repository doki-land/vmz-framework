/**
 * Build `vmz-napi` and copy the shared library into `packages/runtimes/vmz/` as a `.node` addon.
 *
 * Usage: node scripts/build-napi.mjs [--release]
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const profile = release ? 'release' : 'debug';

function platformTriple() {
    const { platform, arch } = process;
    if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc';
    if (platform === 'win32' && arch === 'arm64') return 'win32-arm64-msvc';
    if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
    if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
    if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
    if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
    return `${platform}-${arch}`;
}

const cargoArgs = ['build', '--manifest-path', path.join(root, 'Cargo.toml'), '-p', 'vmz-napi'];
if (release) cargoArgs.push('--release');

console.log(`cargo ${cargoArgs.join(' ')}`);
const build = spawnSync('cargo', cargoArgs, { cwd: root, stdio: 'inherit' });
if (build.status !== 0) {
    process.exit(build.status ?? 1);
}

const targetDir = path.join(root, 'target', profile);
const stem = 'vmz_napi';
// Windows: vmz_napi.dll; Unix cdylib: libvmz_napi.so / libvmz_napi.dylib
const candidates = [];
if (process.platform === 'win32') {
    candidates.push(`${stem}.dll`, `${stem}.node`);
} else if (process.platform === 'darwin') {
    candidates.push(`lib${stem}.dylib`, `${stem}.dylib`, `lib${stem}.so`, `${stem}.so`, `${stem}.node`);
} else {
    candidates.push(`lib${stem}.so`, `${stem}.so`, `${stem}.node`);
}

let artifact = null;
for (const name of candidates) {
    const p = path.join(targetDir, name);
    if (existsSync(p)) {
        artifact = p;
        break;
    }
}

// Some toolchains put cdylib under deps/
if (!artifact) {
    const deps = path.join(targetDir, 'deps');
    if (existsSync(deps)) {
        for (const name of readdirSync(deps)) {
            const base = name.replace(/^lib/, '');
            if (
                (name === stem || name.startsWith(`${stem}.`) || base.startsWith(`${stem}.`) || name.startsWith(`lib${stem}.`)) &&
                (name.endsWith('.dll') || name.endsWith('.so') || name.endsWith('.dylib') || name.endsWith('.node'))
            ) {
                artifact = path.join(deps, name);
                break;
            }
        }
    }
}

if (!artifact) {
    console.error(`Could not find lib${stem} / ${stem} .{dll,so,dylib,node} under ${targetDir}`);
    process.exit(1);
}

const outDir = path.join(root, 'packages', 'runtimes', 'vmz');
mkdirSync(outDir, { recursive: true });
const triple = platformTriple();
const destNamed = path.join(outDir, `vmz.${triple}.node`);
const destPlain = path.join(outDir, 'vmz.node');
copyFileSync(artifact, destNamed);
copyFileSync(artifact, destPlain);
console.log(`Copied ${artifact}`);
console.log(`  → ${destNamed}`);
console.log(`  → ${destPlain}`);

// Optional platform package stub (npm optionalDependencies layout).
const platformPkg = path.join(root, 'packages', 'runtimes', `vmz-${triple}`);
if (existsSync(platformPkg) || triple === 'win32-x64-msvc') {
    mkdirSync(platformPkg, { recursive: true });
    const platNamed = path.join(platformPkg, `vmz.${triple}.node`);
    const platPlain = path.join(platformPkg, 'vmz.node');
    copyFileSync(artifact, platNamed);
    copyFileSync(artifact, platPlain);
    console.log(`  → ${platNamed}`);
    console.log(`  → ${platPlain}`);
}

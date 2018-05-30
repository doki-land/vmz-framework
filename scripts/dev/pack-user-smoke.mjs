import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGE = process.env.STAGE || path.join(process.env.TEMP || '/tmp', 'vmz-user-packs');
const VER = '0.0.3-press.0';

const packs = [
    { dir: 'packages/runtimes/vmz-protocol', name: '@vmz/protocol' },
    { dir: 'packages/runtimes/vmz-runtime', name: '@vmz/core' },
    { dir: 'packages/runtimes/vmz-test', name: '@vmz/test' },
    { dir: 'packages/plugins/vmz-plugin', name: '@vmz/plugin' },
    { dir: 'packages/plugins/vmz-plugin-markdown-it', name: '@vmz/plugin-markdown-it' },
    { dir: 'packages/runtimes/vmz', name: '@vmz/vmz' },
    { dir: 'packages/runtimes/vmz-win32-x64', name: '@vmz/vmz-win32-x64' },
];

function rewrite(deps) {
    if (!deps) return deps;
    const out = {};
    for (const [k, v] of Object.entries(deps)) {
        if (typeof v === 'string' && (v.startsWith('workspace:') || v === '*')) {
            out[k === 'vmz' ? '@vmz/vmz' : k] = VER;
        } else {
            out[k] = v;
        }
    }
    return out;
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const p of packs) {
    const abs = path.join(ROOT, p.dir);
    const raw = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
    const dest = path.join(STAGE, p.name.replace('@', '').replace('/', '-'));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(abs, dest, {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes(`${path.sep}tests${path.sep}`),
    });
    if (p.name === '@vmz/vmz') {
        for (const f of fs.readdirSync(dest)) {
            if (f.endsWith('.node')) fs.unlinkSync(path.join(dest, f));
        }
    }
    const pkg = { ...raw, name: p.name, version: VER };
    delete pkg.private;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        if (pkg[field]) pkg[field] = rewrite(pkg[field]);
    }
    delete pkg.devDependencies;
    if (p.name === '@vmz/vmz') {
        pkg.optionalDependencies = {
            '@vmz/vmz-win32-x64': VER,
            '@vmz/vmz-win32-arm64': VER,
            '@vmz/vmz-darwin-x64': VER,
            '@vmz/vmz-darwin-arm64': VER,
            '@vmz/vmz-linux-x64': VER,
            '@vmz/vmz-linux-arm64': VER,
        };
        pkg.dependencies = { ...(pkg.dependencies || {}), '@vmz/core': VER };
    }
    fs.writeFileSync(path.join(dest, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    const r = spawnSync('npm', ['pack', '--pack-destination', STAGE], {
        cwd: dest,
        encoding: 'utf8',
        shell: true,
    });
    const tail = `${r.stdout}\n${r.stderr}`.trim().split(/\n/).filter(Boolean).at(-1);
    console.log(p.name, `status=${r.status}`, tail);
    if (r.status !== 0) process.exit(1);
}

console.log('STAGE', STAGE);

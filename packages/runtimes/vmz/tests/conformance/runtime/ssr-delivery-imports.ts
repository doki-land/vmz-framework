/**
 * ssr-delivery-imports — every relative ESM specifier in the SSR delivery resolves.
 *
 * The delivery flattens shared modules to the output root, so a nested module such
 * as `ssr/serialize.js` must import `../dom-attr-normalize.js` rather than a
 * `shared/…` path that only exists at another depth. A stale rewrite leaves the
 * serve host unable to load the page, so this gate builds the `counter` example,
 * walks every emitted module and requires each relative import to name an existing
 * file. It then starts the real serve host and requires `GET /` to render the page.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv, serveHostProjectEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'counter');
const dist = path.join(example, 'dist', 'web-ssr');
const PORT = 18787;

function fail(msg: string): never {
    console.error(`ssr-delivery-imports GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ssr-delivery-imports: vmz build counter…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const nestedSsr = path.join(dist, 'ssr', 'serialize.js');
if (!fs.existsSync(nestedSsr)) fail(`missing nested delivery module ${nestedSsr}`);

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(?:m?js|cjs)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const SPECIFIER_PATTERNS = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
];

const files = walk(dist);
if (files.length === 0) fail(`no modules under ${dist}`);
let relative = 0;
const unresolved: string[] = [];
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of SPECIFIER_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (!specifier.startsWith('.')) continue;
            relative++;
            const target = path.resolve(path.dirname(file), specifier);
            if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
                unresolved.push(`${path.relative(dist, file)} -> ${specifier}`);
            }
        }
    }
}
if (relative === 0) fail('no relative import specifiers were found to verify');
if (unresolved.length > 0) {
    fail(`relative imports do not resolve:\n${unresolved.join('\n')}`);
}

const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail(`missing ${hostJs}`);
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostProjectEnv(example, {
        VMZ_DIST: dist,
        VMZ_HOST: '127.0.0.1',
        VMZ_PORT: String(PORT),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
});
try {
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('serve-host start timeout')), 15000);
        child.stdout.on('data', (buf) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr.on('data', (buf) => process.stderr.write(buf));
        child.on('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`serve-host exited early ${code}`));
        });
    });

    const response = await fetch(`http://127.0.0.1:${PORT}/`);
    if (!response.ok) fail(`GET / returned ${response.status}`);
    const html = await response.text();
    if (!html.includes('data-testid="counter-root"')) {
        fail('GET / did not render the counter page');
    }
} finally {
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

console.log(`ssr-delivery-imports: ${relative} relative specifiers across ${files.length} modules resolve`);
console.log('ssr-delivery-imports GATE PASS');

/**
 * `vmz serve` must preview a pruned `--profile static` artifact.
 *
 * The `web-static` delivery prunes the Node runtime face, page modules and
 * `_vmz/pack-node/`, so spawning the SSR host ends in `ERR_MODULE_NOT_FOUND`
 * for `<artifact>/vmz-runtime.js`. `serve` must detect the `web-static` assembly
 * from `_vmz/assemble-manifest.json` and serve the emitted HTML through the
 * build's CDN policy instead of rebuilding the pruned files or faking them.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const ORIGIN = 'https://static.example.test';
const PORT = 18777;

function fail(msg: string): never {
    console.error(`serve-static-profile FAIL: ${msg}`);
    process.exit(1);
}

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
        });
        req.on('error', reject);
    });
}

console.log('serve-static-profile: vmz build --profile static…');
const example = path.join(root, ...EXAMPLE.split('/'));
const dist = path.join(example, 'dist', 'static');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--profile', 'static', '--origin', ORIGIN], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
if (build.status !== 0) {
    fail(`vmz build --profile static exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const assemblePath = path.join(dist, '_vmz', 'assemble-manifest.json');
if (!fs.existsSync(assemblePath)) fail(`missing ${assemblePath}`);
const assemble = JSON.parse(fs.readFileSync(assemblePath, 'utf8'));
if (assemble.assembly !== 'web-static') fail(`built assembly is "${assemble.assembly}", expected "web-static"`);
// The prune contract is the reason this gate exists: without a missing Node
// runtime face the SSR host would start and the regression would stay hidden.
if (fs.existsSync(path.join(dist, 'vmz-runtime.js'))) {
    fail('artifact still ships `vmz-runtime.js`, so the web-static prune contract changed');
}

console.log('serve-static-profile: vmz serve --profile static…');
const child = spawn(process.execPath, [vmzBin(root), 'serve', example, '--profile', 'static', '--port', String(PORT)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
let stdout = '';
let stderr = '';
let exited: number | null = null;
child.stdout.on('data', (d) => {
    stdout += String(d);
});
child.stderr.on('data', (d) => {
    stderr += String(d);
});
child.on('exit', (code) => {
    exited = code ?? 0;
});

async function waitForServer(): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (exited !== null) fail(`serve exited ${exited} before serving\n${stdout}\n${stderr}`);
        try {
            const res = await get(`http://127.0.0.1:${PORT}/`);
            if (res.status === 200) return;
        } catch {
            // not listening yet
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    fail(`serve did not answer on :${PORT} within 15s\n${stdout}\n${stderr}`);
}

try {
    await waitForServer();
    if (stderr.includes('ERR_MODULE_NOT_FOUND')) fail(`serve still spawns the pruned SSR host\n${stderr}`);
    // The SSR branch re-materializes the Node host onto the artifact. Static preview
    // must leave a delivery artifact untouched, so nothing may appear in `_vmz/host`.
    if (fs.existsSync(path.join(dist, '_vmz', 'host'))) {
        fail('serve materialized the Node host into the pruned artifact');
    }

    const home = await get(`http://127.0.0.1:${PORT}/`);
    if (home.status !== 200) fail(`GET / -> ${home.status}`);
    if (!home.body.includes('data-vmz-page')) fail('GET / did not return the emitted page HTML');

    const about = await get(`http://127.0.0.1:${PORT}/about/`);
    if (about.status !== 200) fail(`GET /about/ -> ${about.status}`);
    if (!about.body.includes('data-vmz-page')) fail('GET /about/ did not return the emitted page HTML');

    const missing = await get(`http://127.0.0.1:${PORT}/no-such-route`);
    if (missing.status !== 404) fail(`GET /no-such-route -> ${missing.status}, expected 404`);
    if (!missing.body.includes('route-static-404')) fail('404 response is not the emitted 404 document');

    const deployment = await get(`http://127.0.0.1:${PORT}/vmz-deployment.json`);
    if (deployment.status !== 200) fail(`GET /vmz-deployment.json -> ${deployment.status}`);
} finally {
    child.kill();
}

console.log('serve-static-profile GATE PASS: `vmz serve` previews the pruned web-static artifact');

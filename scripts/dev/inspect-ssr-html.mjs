import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveNativePath } from 'vmz';
import { inspectSsrHtml } from './ssr-html-checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOMEPAGE = path.join(ROOT, 'packages', 'homepage');
const PORT = Number(process.env.VMZ_SSR_INSPECT_PORT || 18820);
const HOST = process.env.VMZ_SSR_INSPECT_HOST || '127.0.0.1';

function resolveDist() {
    const fromEnv = process.env.VMZ_HOMEPAGE_DIST;
    if (fromEnv && fs.existsSync(path.join(fromEnv, 'vmz-serve-host.mjs'))) return fromEnv;
    const nested = path.join(HOMEPAGE, 'dist', 'web-ssr');
    if (fs.existsSync(path.join(nested, 'vmz-serve-host.mjs'))) return nested;
    const flat = path.join(HOMEPAGE, 'dist');
    if (fs.existsSync(path.join(flat, 'vmz-serve-host.mjs'))) return flat;
    return null;
}

function ensureBuild() {
    const existing = resolveDist();
    if (existing && process.env.SKIP_BUILD === '1') return existing;
    if (existing) return existing;
    console.log('inspect-ssr-html: building homepage…');
    const r = spawnSync('pnpm', ['--filter', '@vmz/homepage', 'build'], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true,
    });
    if (r.status !== 0) {
        console.error(r.stdout || r.stderr || 'homepage build failed');
        process.exit(1);
    }
    const dist = resolveDist();
    if (!dist) {
        console.error('inspect-ssr-html: homepage dist missing vmz-serve-host.mjs after build');
        process.exit(1);
    }
    return dist;
}

async function fetchHomeSsr(dist) {
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    const child = spawn(process.execPath, [hostJs], {
        cwd: dist,
        env: {
            ...process.env,
            VMZ_NATIVE_NODE: resolveNativePath(),
            VMZ_PROJECT_ROOT: HOMEPAGE,
            VMZ_DIST: dist,
            VMZ_HOST: HOST,
            VMZ_PORT: String(PORT),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseUrl = `http://${HOST}:${PORT}`;
    try {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(`${baseUrl}/`);
                if (res.ok) return await res.text();
            } catch {
                /* retry */
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error(`serve host did not become ready at ${baseUrl}`);
    } finally {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            child.kill('SIGTERM');
        }
    }
}

const dist = ensureBuild();
console.log(`inspect-ssr-html: reading live SSR from ${path.relative(ROOT, dist)}`);
const html = await fetchHomeSsr(dist);
const { ok, failures } = inspectSsrHtml(html);

if (ok) {
    console.log('PASS: R1 button slot stays inside <button>');
    console.log('PASS: R2 SVG region hosts avoid HTML span wrappers');
    console.log('PASS: feature icon path present in SSR HTML');
    console.log('inspect-ssr-html: all SSR rendering checks passed');
    process.exit(0);
}

for (const msg of failures) console.error(`FAIL: ${msg}`);
console.error(`inspect-ssr-html: ${failures.length} failure(s)`);
process.exit(1);

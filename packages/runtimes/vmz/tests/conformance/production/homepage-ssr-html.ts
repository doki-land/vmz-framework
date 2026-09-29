/**
 * Commercial visual spec R1/R2 — live homepage SSR HTML rendering contract.
 * verify id: homepage-ssr-html
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const { inspectSsrHtml } = await import(pathToFileURL(path.join(root, 'scripts/dev/ssr-html-checks.mjs')).href);
const HOMEPAGE = 'packages/homepage';
const PORT = Number(process.env.VMZ_SSR_INSPECT_PORT || 18820);

function fail(msg: string): never {
    console.error(`homepage-ssr-html FAIL: ${msg}`);
    process.exit(1);
}

async function stopServeChild(child: ReturnType<typeof spawn> | null | undefined): Promise<void> {
    if (!child || child.exitCode != null || child.killed) return;
    const pid = child.pid;
    await new Promise<void>((resolve) => {
        const done = () => resolve();
        child.once('exit', done);
        try {
            if (process.platform === 'win32' && pid) {
                spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
            } else {
                child.kill('SIGTERM');
            }
        } catch {
            /* ignore */
        }
        setTimeout(done, 3000);
    });
}

console.log('homepage-ssr-html: build homepage…');
const build = runVmzBuild(HOMEPAGE, root);
if (build.status !== 0) {
    fail(`homepage build exited ${build.status}\n${(build.stderr || build.stdout).slice(0, 1200)}`);
}

const dist = build.dist;
const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) {
    fail('missing vmz-serve-host.mjs after homepage build');
}

console.log('homepage-ssr-html: serve homepage SSR…');
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostChildEnv({ VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
});

let html = '';
try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/`);
            if (res.ok) {
                html = await res.text();
                break;
            }
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    if (!html) {
        fail(`serve host did not become ready at ${baseUrl}`);
    }
} finally {
    await stopServeChild(child);
}

const inspect = inspectSsrHtml(html);
if (!inspect.ok) {
    fail(inspect.failures.join('; '));
}

const detail = 'Button slots, SVG regions, and first-response highlighted code passed on live homepage SSR';
const proof = readProof(root);
upsertCheck(proof, {
    id: 'homepage-ssr-html',
    status: 'passed',
    detail,
});
addLimitation(proof, 'homepage-ssr-html: subset of official-homepage SSR inspect for faster R1/R2 iteration');
writeProof(proof, root);

console.log(`homepage-ssr-html PASS: ${detail}`);

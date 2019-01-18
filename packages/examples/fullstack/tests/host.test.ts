import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test/expect.mjs';
import { exampleDist, exampleRoot } from '@vmz-examples/test-utils';
import { resolveNativePath } from 'vmz';

const dist = exampleDist('fullstack');
const root = exampleRoot('fullstack');

/** Kill process and Windows child tree (vmz.exe leaves serve-host otherwise). */
function killProcTree(proc: { pid?: number; kill: () => void }) {
    if (proc.pid && process.platform === 'win32') {
        try {
            execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
            return;
        } catch {
            /* fall through */
        }
    }
    try {
        proc.kill();
    } catch {
        /* already dead */
    }
}

async function waitFor(pred: () => Promise<boolean>, label: string, log: () => string, timeoutMs = 25_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            if (await pred()) return;
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`${label} timed out\n${log()}`);
}

describe('fullstack host', () => {
    it('vmz-serve-host serves SSR, entry-client, and RPC', async () => {
        const hostJs = path.join(dist, 'vmz-serve-host.mjs');
        const port = 18080 + Math.floor(Math.random() * 1000);
        const proc = spawn(process.execPath, [hostJs], {
            cwd: root,
            env: {
                ...process.env,
                VMZ_DIST: dist,
                VMZ_HOST: '127.0.0.1',
                VMZ_PORT: String(port),
                VMZ_NATIVE_NODE: resolveNativePath(),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let boot = '';
        proc.stdout.on('data', (c) => {
            boot += c.toString();
        });
        proc.stderr.on('data', (c) => {
            boot += c.toString();
        });

        const base = `http://127.0.0.1:${port}`;
        try {
            await waitFor(
                async () => {
                    const res = await fetch(`${base}/`);
                    if (res.status !== 200) return false;
                    const html = await res.text();
                    if (!html.includes('Ada') || !html.includes('entry-client.js')) {
                        throw new Error(`bad html ${html.slice(0, 240)}`);
                    }
                    const js = await (await fetch(`${base}/entry-client.js`)).text();
                    // Thin entry: hydrateRoute + dynamic page import; no registry / eager UserCard.
                    if (!js.includes('hydrateRoute') || js.includes('registerComponents')) {
                        throw new Error(`bad entry ${js.slice(0, 240)}`);
                    }
                    const pageJs = await (await fetch(`${base}/pages/index.client.js`)).text();
                    if (!pageJs.includes('UserCard') || !pageJs.includes('api.component')) {
                        throw new Error(`bad page ${pageJs.slice(0, 240)}`);
                    }
                    const body = await (
                        await fetch(`${base}/__vmz/rpc`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                moduleId: '#server/components/UserCard',
                                method: 'fetchUser',
                                args: [],
                            }),
                        })
                    ).json();
                    return !!body?.name;
                },
                'serve-host ready',
                () => boot,
            );
        } finally {
            killProcTree(proc);
        }
    }, 40_000);

    it('vmz dev soft-reloads without process restart', async () => {
        // Use Node CLI (pnpm/workspace), not target/debug/vmz(.exe) — CI Linux has no .exe.
        const vmzJs = path.resolve(root, '../../../packages/runtimes/vmz/bin/vmz.js');
        const port = 19080 + Math.floor(Math.random() * 500);
        const pagePath = path.join(root, 'src/pages/index.vmz');
        const original = await readFile(pagePath, 'utf8');

        const proc = spawn(process.execPath, [vmzJs, 'dev', '.', '--port', String(port), '--poll-ms', '150'], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let log = '';
        const onData = (c: Buffer) => {
            log += c.toString();
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        const base = `http://127.0.0.1:${port}`;

        try {
            await waitFor(
                async () => {
                    const html = await (await fetch(`${base}/`)).text();
                    return html.includes('Full-stack VMZ') && html.includes('Ada');
                },
                'initial serve',
                () => log,
            );

            const marker = `DevSmoke${Date.now()}`;
            await writeFile(pagePath, original.replace('Full-stack VMZ', marker), 'utf8');

            await waitFor(
                async () => log.includes('soft reload ok'),
                'soft reload log',
                () => log,
            );
            await waitFor(
                async () => {
                    const html = await (await fetch(`${base}/`)).text();
                    return html.includes(marker) && html.includes('Ada');
                },
                'updated SSR',
                () => log,
            );

            expect(log).not.toContain('restarting server');
        } finally {
            killProcTree(proc);
            await writeFile(pagePath, original, 'utf8');
            await new Promise((r) => setTimeout(r, 200));
        }
    }, 60_000);
});

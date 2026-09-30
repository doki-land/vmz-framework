/**
 * Shared live homepage SSR fetch — same retry contract for conformance + dev scripts.
 */

import http from 'node:http';
import type { ChildProcess } from 'node:child_process';

export type SsrHtmlInspect = { ok: boolean; failures: string[] };

export function waitServeReady(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('serve-host start timeout')), timeoutMs);
        const onData = (buf: Buffer) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(t);
                child.stdout?.off('data', onData);
                child.stderr?.off('data', onData);
                resolve();
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', (buf) => {
            process.stderr.write(buf);
            onData(buf);
        });
        child.on('error', (err) => {
            clearTimeout(t);
            reject(err);
        });
        child.on('exit', (code) => {
            if (code != null && code !== 0) {
                clearTimeout(t);
                reject(new Error(`serve-host exited early ${code}`));
            }
        });
    });
}

export function getHttp(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
        });
        req.on('error', reject);
    });
}

/**
 * Poll GET / until SSR HTML passes inspect or deadline (matches `inspect-ssr-html.mjs`).
 */
export async function fetchHomepageSsrHtml(
    baseUrl: string,
    inspect: (html: string) => SsrHtmlInspect,
    opts: { deadlineMs?: number; intervalMs?: number } = {},
): Promise<string> {
    const deadline = Date.now() + (opts.deadlineMs ?? 60_000);
    const intervalMs = opts.intervalMs ?? 250;
    let lastFailures: string[] = [];
    while (Date.now() < deadline) {
        try {
            const res = await getHttp(`${baseUrl.replace(/\/$/, '')}/`);
            if (res.status === 200 && res.body) {
                const check = inspect(res.body);
                if (check.ok) return res.body;
                lastFailures = check.failures;
            }
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(lastFailures.length ? lastFailures.join('; ') : 'homepage SSR did not return 200 HTML');
}

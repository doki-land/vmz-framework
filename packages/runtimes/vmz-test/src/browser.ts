/**
 * Browser Host for `vmz test --mode browser` (T2 close slice).
 *
 * Real Chromium/Chrome via CDP. Transport may use puppeteer-core as a CDP
 * client — that is NOT the Playwright/Puppeteer *test model*. Manifest actions
 * and assertions remain the VMZ Browser Host protocol; same Direct schedule as
 * production (`__vmzCreate` in a real document).
 *
 * Design: 规划设计/vmz/16 §T2 · §5 浏览器连接
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveChunkArtifacts } from './compile.js';

type Diag = { severity: string; message: string; [k: string]: unknown };

export type BrowserResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

function findChromeExecutable(): string | null {
    if (process.env.VMZ_BROWSER && fs.existsSync(process.env.VMZ_BROWSER)) {
        return process.env.VMZ_BROWSER;
    }
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    const candidates =
        process.platform === 'win32'
            ? [
                  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
              ]
            : process.platform === 'darwin'
              ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
              : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return null;
}

function startStaticServer(rootDir: string): Promise<{ port: number; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            let rel = decodeURIComponent(url.pathname);
            if (rel === '/' || rel === '/__vmz/harness') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(
                    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>vmz browser host</title></head><body><div id="app"></div></body></html>`,
                );
                return;
            }
            if (rel.startsWith('/')) rel = rel.slice(1);
            const filePath = path.normalize(path.join(rootDir, rel));
            if (!filePath.startsWith(path.normalize(rootDir))) {
                res.writeHead(403);
                res.end('forbidden');
                return;
            }
            if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
        } catch (e) {
            res.writeHead(500);
            res.end(e instanceof Error ? e.message : String(e));
        }
    });
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('browser host: failed to bind'));
                return;
            }
            resolve({
                port: addr.port,
                close: () =>
                    new Promise((res, rej) => {
                        server.close((err) => (err ? rej(err) : res()));
                    }),
            });
        });
        server.on('error', reject);
    });
}

async function loadPuppeteerCore(): Promise<{
    launch: (...args: any[]) => Promise<any>;
    connect: (...args: any[]) => Promise<any>;
}> {
    try {
        const mod: any = await import('puppeteer-core');
        const puppeteer = mod?.default ?? mod;
        if (typeof puppeteer?.launch !== 'function') {
            throw new Error('puppeteer-core.launch missing');
        }
        if (typeof puppeteer?.connect !== 'function') {
            throw new Error('puppeteer-core.connect missing');
        }
        return puppeteer;
    } catch (err) {
        throw new Error(
            `puppeteer-core required for browser mode (CDP transport). Install in @vmz/test or set workspace dep. (${err instanceof Error ? err.message : err})`,
        );
    }
}

function waitLocalPort(port: number, ms = 20_000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            const socket = net.connect({ port, host: '127.0.0.1' }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', () => {
                if (Date.now() - start > ms) reject(new Error(`port ${port} not open within ${ms}ms`));
                else setTimeout(tick, 100);
            });
        };
        tick();
    });
}

/** Spawn Chrome with remote debugging and connect — more reliable on GHA than puppeteer.launch. */
async function connectChromeViaDebugPort(
    puppeteer: { connect: (...args: any[]) => Promise<any> },
    chromePath: string,
    args: string[],
): Promise<{ browser: any; child: ChildProcess; profileDir: string }> {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-browser-'));
    const port = 9200 + Math.floor(Math.random() * 700);
    const child = spawn(
        chromePath,
        [...args, `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', 'about:blank'],
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, HOME: profileDir },
        },
    );
    child.stderr?.on('data', () => {});
    child.stdout?.on('data', () => {});
    try {
        await waitLocalPort(port);
        const browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${port}`,
            protocolTimeout: 60_000,
        });
        return { browser, child, profileDir };
    } catch (err) {
        try {
            child.kill('SIGKILL');
        } catch {
            /* ignore */
        }
        try {
            fs.rmSync(profileDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
        throw err;
    }
}

export async function runBrowserManifest(
    manifest: Record<string, unknown>,
    ctx: {
        outDir: string;
    },
): Promise<BrowserResult> {
    const diagnostics: Diag[] = [];
    const fail = (message: string, extra: Record<string, unknown> = {}) => {
        diagnostics.push({ severity: 'error', message, ...extra });
    };

    const program = manifest.program && typeof manifest.program === 'object' ? (manifest.program as Record<string, unknown>) : {};
    const chunkId = String(program.chunkId || '');
    const programId = chunkId || null;

    if (!chunkId) {
        fail('program.chunkId missing');
        return { status: 'error', diagnostics, planId: null, programId: null };
    }

    const arts = resolveChunkArtifacts(ctx.outDir, chunkId);
    if (!arts.clientPath) {
        fail(`missing ${chunkId}.client.js`);
        return { status: 'failed', diagnostics, planId: null, programId };
    }

    const chrome = findChromeExecutable();
    if (!chrome) {
        fail('browser host: Chrome/Edge not found (set VMZ_BROWSER or CHROME_PATH to a Chromium binary)');
        return { status: 'error', diagnostics, planId: null, programId };
    }

    let server: { port: number; close: () => Promise<void> } | null = null;
    let browser: any = null;
    let profileDir: string | null = null;
    let chromeChild: ChildProcess | null = null;

    try {
        const puppeteer = await loadPuppeteerCore();
        server = await startStaticServer(ctx.outDir);
        const origin = `http://127.0.0.1:${server.port}`;

        // CI: spawn+connect first (puppeteer.launch often "Connection closed" on Chrome for Testing).
        const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
        const commonArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--font-render-hinting=none',
            '--mute-audio',
            '--disable-extensions',
        ];
        let lastLaunchErr: unknown;
        if (ci) {
            try {
                if (process.env.VMZ_BROWSER_DEBUG === '1') {
                    console.error(`[vmz-test browser] chrome=${chrome} try=spawn+connect`);
                }
                const connected = await connectChromeViaDebugPort(puppeteer, chrome, [...commonArgs, '--headless=new']);
                browser = connected.browser;
                chromeChild = connected.child;
                profileDir = connected.profileDir;
                lastLaunchErr = null;
            } catch (err) {
                lastLaunchErr = err;
                console.error(`[vmz-test browser] spawn+connect failed: ${err instanceof Error ? err.message : err}`);
            }
        }
        if (!browser) {
            const launchAttempts = ci
                ? [
                      { label: 'pipe', pipe: true, args: [...commonArgs, '--headless=new'] },
                      { label: 'ws', pipe: false, args: [...commonArgs, '--headless=new'] },
                      {
                          label: 'pipe+single-process',
                          pipe: true,
                          args: [...commonArgs, '--headless=new', '--single-process', '--disable-software-rasterizer'],
                      },
                  ]
                : [{ label: 'local', pipe: false, args: commonArgs }];

            for (const attempt of launchAttempts) {
                profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-browser-'));
                try {
                    if (ci || process.env.VMZ_BROWSER_DEBUG === '1') {
                        console.error(`[vmz-test browser] chrome=${chrome} try=${attempt.label} args=${attempt.args.join(' ')}`);
                    }
                    browser = await puppeteer.launch({
                        executablePath: chrome,
                        headless: true,
                        pipe: attempt.pipe,
                        protocolTimeout: 60_000,
                        dumpio: process.env.VMZ_BROWSER_DEBUG === '1',
                        args: [...attempt.args, `--user-data-dir=${profileDir}`, '--no-first-run'],
                    });
                    await new Promise((r) => setTimeout(r, 200));
                    lastLaunchErr = null;
                    break;
                } catch (err) {
                    lastLaunchErr = err;
                    browser = null;
                    try {
                        fs.rmSync(profileDir, { recursive: true, force: true });
                    } catch {
                        /* ignore */
                    }
                    profileDir = null;
                    console.error(`[vmz-test browser] launch ${attempt.label} failed: ${err instanceof Error ? err.message : err}`);
                }
            }
        }
        if (!browser) {
            throw lastLaunchErr instanceof Error ? lastLaunchErr : new Error(`browser launch failed: ${String(lastLaunchErr)}`);
        }
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${origin}/__vmz/harness`, { waitUntil: 'domcontentloaded' });

        const components = program.components && typeof program.components === 'object' ? (program.components as Record<string, string>) : {};

        const boot = await page.evaluate(
            async (cfg: { origin: string; chunkPath: string; components: Record<string, string> }) => {
                const dom = await import(/* @vite-ignore */ `${cfg.origin}/vmz-dom.js`);
                const Comp = (await import(/* @vite-ignore */ `${cfg.origin}/${cfg.chunkPath}.client.js`)).default;
                const map: Record<string, unknown> = {};
                for (const [name, chunk] of Object.entries(cfg.components)) {
                    map[name] = (await import(/* @vite-ignore */ `${cfg.origin}/${chunk}.client.js`)).default;
                }
                if (Object.keys(map).length && typeof dom.registerComponents === 'function') {
                    dom.registerComponents(map);
                }
                const app = document.getElementById('app');
                if (!app) return { ok: false, error: '#app missing' };
                if (!Comp?.__vmzDirect || typeof Comp.__vmzCreate !== 'function') {
                    return { ok: false, error: 'Direct __vmzCreate required' };
                }
                (window as any).__vmzBrowser = {
                    dom,
                    Comp,
                    app,
                    inst: null as unknown,
                    buttonBefore: null as Element | null,
                    capturedChild: null as unknown,
                    lastPrecision: null as unknown,
                };
                return { ok: true };
            },
            {
                origin,
                chunkPath: chunkId.replace(/\\/g, '/'),
                components,
            },
        );

        if (!boot?.ok) {
            fail(`browser boot: ${boot?.error || 'unknown'}`);
            return {
                status: 'error',
                diagnostics,
                planId: null,
                programId,
            };
        }

        const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
        for (const raw of actions) {
            const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const kind = String(a.kind || '');
            try {
                if (kind === 'mount') {
                    const props = a.props && typeof a.props === 'object' ? a.props : {};
                    const r = await page.evaluate(async (p: object) => {
                        const ctx = (window as any).__vmzBrowser;
                        let createHits = 0;
                        const orig = ctx.Comp.__vmzCreate;
                        ctx.Comp.__vmzCreate = function (this: unknown, api: unknown) {
                            createHits += 1;
                            return orig.call(this, api);
                        };
                        ctx.inst = await ctx.dom.mount(ctx.Comp, ctx.app, p);
                        ctx.Comp.__vmzCreate = orig;
                        ctx.buttonBefore = ctx.app.querySelector('button');
                        return { createHits, text: ctx.app.textContent || '' };
                    }, props);
                    if (r.createHits !== 1) fail(`mount must call __vmzCreate once, got ${r.createHits}`);
                    continue;
                }
                if (kind === 'click') {
                    const selector = typeof a.selector === 'string' ? a.selector : 'button';
                    // Real browser input path: Element.click in page (not linkedom).
                    const ok = await page.evaluate((sel: string) => {
                        const ctx = (window as any).__vmzBrowser;
                        const el = ctx.app.querySelector(sel) as HTMLElement | null;
                        if (!el) return false;
                        el.click();
                        return true;
                    }, selector);
                    if (!ok) fail(`click: no element for ${JSON.stringify(selector)}`);
                    continue;
                }
                if (kind === 'write') {
                    const field = String(a.field || '');
                    await page.evaluate(
                        (args: { field: string; value: unknown }) => {
                            const ctx = (window as any).__vmzBrowser;
                            if (!ctx.inst) throw new Error('write before mount');
                            ctx.inst[args.field] = args.value;
                        },
                        { field, value: a.value },
                    );
                    continue;
                }
                if (kind === 'flush') {
                    await page.evaluate(async () => {
                        const ctx = (window as any).__vmzBrowser;
                        if (!ctx.inst) throw new Error('flush before mount');
                        await ctx.dom.flushPending(ctx.inst);
                    });
                    continue;
                }
                if (kind === 'destroy') {
                    await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        if (!ctx.inst) throw new Error('destroy before mount');
                        ctx.dom.destroy(ctx.inst);
                    });
                    continue;
                }
                if (kind === 'capture_child') {
                    const selector = typeof a.selector === 'string' ? a.selector : '';
                    const ok = await page.evaluate((sel: string) => {
                        const ctx = (window as any).__vmzBrowser;
                        const el = ctx.app.querySelector(sel) as any;
                        if (!el?.__vmzInst) return false;
                        ctx.capturedChild = el.__vmzInst;
                        return true;
                    }, selector);
                    if (!ok) fail(`capture_child: no inst for ${JSON.stringify(selector)}`);
                    continue;
                }
                if (kind === 'precision_reset') {
                    await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        if (typeof ctx.dom.__vmzPrecisionEnable === 'function') ctx.dom.__vmzPrecisionEnable(true);
                        if (typeof ctx.dom.__vmzPrecisionReset === 'function') ctx.dom.__vmzPrecisionReset();
                    });
                    continue;
                }
                fail(`unknown browser action ${JSON.stringify(kind)}`);
            } catch (e) {
                fail(`action ${kind}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
        for (const raw of assertions) {
            const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const kind = String(a.kind || '');
            const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};

            if (kind === 'text') {
                const text = await page.evaluate(() => {
                    const ctx = (window as any).__vmzBrowser;
                    return ctx.app.textContent || '';
                });
                if (expect.equals != null && text !== String(expect.equals)) {
                    fail(`text equals want ${JSON.stringify(expect.equals)}, got ${JSON.stringify(text)}`);
                }
                if (expect.contains != null && !text.includes(String(expect.contains))) {
                    fail(`text contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(text)}`);
                }
                continue;
            }
            if (kind === 'nodeIdentity') {
                const sel = typeof expect.selector === 'string' ? expect.selector : 'button';
                const same = await page.evaluate((s: string) => {
                    const ctx = (window as any).__vmzBrowser;
                    const after = ctx.app.querySelector(s);
                    return !!(ctx.buttonBefore && after && after === ctx.buttonBefore);
                }, sel);
                if (!same) fail(`nodeIdentity failed for ${sel} (real browser document)`);
                continue;
            }
            if (kind === 'state') {
                const state = await page.evaluate((keys: string[]) => {
                    const ctx = (window as any).__vmzBrowser;
                    const out: Record<string, unknown> = {};
                    for (const k of keys) out[k] = ctx.inst?.[k];
                    return out;
                }, Object.keys(expect));
                for (const [k, v] of Object.entries(expect)) {
                    if (state[k] !== v) {
                        fail(`state.${k} want ${JSON.stringify(v)}, got ${JSON.stringify(state[k])}`);
                    }
                }
                continue;
            }
            if (kind === 'host') {
                if (expect.kind === 'browser' || expect.realDocument === true) {
                    const ok = await page.evaluate(() => typeof document !== 'undefined' && !!(document as any).createElement);
                    if (!ok) fail('host.realDocument failed');
                }
                continue;
            }
            if (kind === 'destroyed') {
                const want = expect.value !== false;
                const got = await page.evaluate(() => {
                    const ctx = (window as any).__vmzBrowser;
                    return Boolean(ctx.inst?.__vmzDestroyed);
                });
                if (got !== want) fail(`__vmzDestroyed want ${want}, got ${got}`);
                continue;
            }
            if (kind === 'childDestroyed') {
                const want = expect.value !== false;
                const got = await page.evaluate(() => {
                    const ctx = (window as any).__vmzBrowser;
                    if (!ctx.capturedChild) return null;
                    return Boolean(ctx.capturedChild.__vmzDestroyed);
                });
                if (got == null) fail('childDestroyed: no captured child (use capture_child action)');
                else if (got !== want) fail(`child __vmzDestroyed want ${want}, got ${got}`);
                continue;
            }
            if (kind === 'precision') {
                const snap = await page.evaluate(() => {
                    const ctx = (window as any).__vmzBrowser;
                    if (typeof ctx.dom.__vmzPrecisionSnapshot !== 'function') return null;
                    return ctx.dom.__vmzPrecisionSnapshot();
                });
                if (!snap) {
                    fail('precision snapshot unavailable');
                    continue;
                }
                if (expect.minWrites != null && Number(snap.writes || 0) < Number(expect.minWrites)) {
                    fail(`precision.writes want >= ${expect.minWrites}, got ${snap.writes}`);
                }
                if (expect.maxWrites != null && Number(snap.writes || 0) > Number(expect.maxWrites)) {
                    fail(`precision.writes want <= ${expect.maxWrites}, got ${snap.writes}`);
                }
                if (expect.maxBindingEvals != null && Number(snap.bindingEvals || 0) > Number(expect.maxBindingEvals)) {
                    fail(`precision.bindingEvals want <= ${expect.maxBindingEvals}, got ${snap.bindingEvals}`);
                }
                if (expect.maxPatchExecs != null && Number(snap.patchExecs || 0) > Number(expect.maxPatchExecs)) {
                    fail(`precision.patchExecs want <= ${expect.maxPatchExecs}, got ${snap.patchExecs}`);
                }
                if (expect.patchesIncludeDep != null) {
                    const dep = String(expect.patchesIncludeDep);
                    const map = (snap.patchesByDep as Record<string, number>) || {};
                    if (!map[dep]) fail(`precision.patchesByDep missing ${dep}: ${JSON.stringify(map)}`);
                }
                if (expect.writesIncludeRoot != null) {
                    const rootKey = String(expect.writesIncludeRoot);
                    const map = (snap.writesByRoot as Record<string, number>) || {};
                    if (!map[rootKey]) fail(`precision.writesByRoot missing ${rootKey}: ${JSON.stringify(map)}`);
                }
                if (expect.domCreates === 0 || expect.domCreates === false) {
                    if (Number(snap.domCreates || 0) !== 0) {
                        fail(`precision.domCreates want 0 after action window, got ${snap.domCreates}`);
                    }
                }
                continue;
            }
            if (kind === 'graph' || kind === 'plan' || kind === 'diagnostic' || kind === 'view') {
                continue;
            }
            fail(`unknown browser assertion ${JSON.stringify(kind)}`);
        }
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
    } finally {
        try {
            if (browser) {
                if (chromeChild) await browser.disconnect();
                else await browser.close();
            }
        } catch {
            /* ignore */
        }
        try {
            if (chromeChild) chromeChild.kill('SIGKILL');
        } catch {
            /* ignore */
        }
        try {
            if (profileDir) {
                fs.rmSync(profileDir, { recursive: true, force: true });
            }
        } catch {
            /* ignore */
        }
        try {
            if (server) await server.close();
        } catch {
            /* ignore */
        }
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId: null,
        programId,
    };
}

/** Resolve chrome path (for gates / diagnostics). */
export function resolveBrowserExecutable(): string | null {
    return findChromeExecutable();
}

/**
 * Browser Host for `vmz test --mode browser` (U0–U2 thin).
 *
 * Real Chromium/Chrome via CDP. Transport may use puppeteer-core as a CDP
 * client — that is NOT the Playwright/Puppeteer *test model*. Manifest actions
 * and assertions remain the VMZ Browser Host protocol.
 *
 * U0: Locator / Action / Expectation dispatcher (browser-protocol.ts).
 * U1: role/label/text/testId; click/fill/press/select; actionability + auto-wait.
 * U2: real serve-host + RouteId open/navigate; console/request fail gate;
 *     wall-clock timing + failure screenshot/DOM (not full U3 artifact pack).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveComponentEntries } from '@vmz/core/component-registry';
import { resolveChunkArtifacts } from './compile.js';
import { createArtifactsDir, writeFailureEvidence, writeTimingOnly, type BrowserTiming, type StepTiming } from './browser-evidence.js';
import { isServeHostManifest, resolveRoutePath, startServeHost, type ServeHostHandle } from './browser-serve.js';
import {
    defaultClickLocator,
    parseActionLocator,
    resolveLocatorInPage,
    sleep,
    type BrowserLocator,
    type LocatorResolveResult,
} from './browser-protocol.js';

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
    const useServe = isServeHostManifest(manifest);
    const testId = String(manifest.id || 'anonymous');
    const profile = manifest.profile && typeof manifest.profile === 'object' ? (manifest.profile as Record<string, unknown>) : {};
    const failOnConsoleError = profile.failOnConsoleError !== false && (useServe || profile.failOnConsoleError === true);
    const failOnRequestFailed = profile.failOnRequestFailed !== false && (useServe || profile.failOnRequestFailed === true);

    if (!chunkId) {
        fail('program.chunkId missing');
        return { status: 'error', diagnostics, planId: null, programId: null };
    }

    if (!useServe) {
        const arts = resolveChunkArtifacts(ctx.outDir, chunkId);
        if (!arts.clientPath) {
            fail(`missing ${chunkId}.client.js`);
            return { status: 'failed', diagnostics, planId: null, programId };
        }
    } else if (!fs.existsSync(path.join(ctx.outDir, 'vmz-serve-host.mjs'))) {
        fail(`serve host: missing vmz-serve-host.mjs under ${ctx.outDir}`);
        return { status: 'failed', diagnostics, planId: null, programId };
    }

    const chrome = findChromeExecutable();
    if (!chrome) {
        fail('browser host: Chrome/Edge not found (set VMZ_BROWSER or CHROME_PATH to a Chromium binary)');
        return { status: 'error', diagnostics, planId: null, programId };
    }

    let server: { port: number; close: () => Promise<void> } | null = null;
    let serveHost: ServeHostHandle | null = null;
    let browser: any = null;
    let profileDir: string | null = null;
    let chromeChild: ChildProcess | null = null;
    let page: any = null;
    const stepTimings: StepTiming[] = [];
    const runStarted = Date.now();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const artifactsDir = createArtifactsDir(ctx.outDir, testId);

    const recordStep = (phase: StepTiming['phase'], kind: string, started: number, ok: boolean, detail?: string) => {
        stepTimings.push({ phase, kind, ms: Date.now() - started, ok, detail });
    };

    try {
        const puppeteer = await loadPuppeteerCore();
        let origin: string;
        if (useServe) {
            serveHost = await startServeHost(ctx.outDir);
            origin = serveHost.origin;
        } else {
            server = await startStaticServer(ctx.outDir);
            origin = `http://127.0.0.1:${server.port}`;
        }

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
        page = await browser.newPage();
        page.setDefaultTimeout(15000);
        page.on('console', (msg: { type: () => string; text: () => string }) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err: Error) => {
            consoleErrors.push(err instanceof Error ? err.message : String(err));
        });
        page.on('requestfailed', (req: { url: () => string; resourceType?: () => string; failure: () => { errorText?: string } | null }) => {
            const url = req.url();
            const rt = typeof req.resourceType === 'function' ? req.resourceType() : '';
            if (url.includes('favicon') || rt === 'image' || rt === 'media' || rt === 'font') return;
            const why = req.failure()?.errorText || 'failed';
            // SPA client nav often aborts in-flight document; ignore benign aborts.
            if (why.includes('ERR_ABORTED') || why.includes('net::ERR_ABORTED')) return;
            failedRequests.push(`${url} (${why})`);
        });

        if (useServe) {
            (page as any).__vmzServeOrigin = origin;
            (page as any).__vmzServeMode = true;
        } else {
            await page.goto(`${origin}/__vmz/harness`, { waitUntil: 'domcontentloaded' });

            const explicitComponents =
                program.components && typeof program.components === 'object' ? (program.components as Record<string, string>) : undefined;
            const registryStrict = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
            const registryEntries = await resolveComponentEntries(ctx.outDir, explicitComponents, {
                strict: registryStrict,
                closureRoots: [chunkId.replace(/\\/g, '/')],
            });

            const boot = await page.evaluate(
                async (cfg: { origin: string; chunkPath: string; registry: Array<{ name: string; entry: string }> }) => {
                    const dom = await import(/* @vite-ignore */ `${cfg.origin}/vmz-dom.js`);
                    const Comp = (await import(/* @vite-ignore */ `${cfg.origin}/${cfg.chunkPath}.client.js`)).default;
                    const map: Record<string, unknown> = {};
                    for (const { name, entry } of cfg.registry) {
                        map[name] = (await import(/* @vite-ignore */ `${cfg.origin}/${entry}`)).default;
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
                    registry: registryEntries,
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
        }

        const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
        for (const raw of actions) {
            const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const kind = String(a.kind || '');
            const started = Date.now();
            let stepOk = true;
            try {
                if (kind === 'open' || kind === 'navigate') {
                    const pathname = resolveRoutePath(ctx.outDir, {
                        routeId: a.routeId != null ? String(a.routeId) : undefined,
                        path: a.path != null ? String(a.path) : undefined,
                        params:
                            a.params && typeof a.params === 'object'
                                ? Object.fromEntries(Object.entries(a.params as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
                                : undefined,
                    });
                    const url = new URL(pathname, origin).toString();
                    await page.goto(url, { waitUntil: 'domcontentloaded' });
                    const timeoutMs = Number(a.timeoutMs) > 0 ? Number(a.timeoutMs) : 8000;
                    const deadline = Date.now() + timeoutMs;
                    while (Date.now() <= deadline) {
                        const loc = await page.evaluate(() => ({
                            path: location.pathname,
                            ready: document.readyState,
                        }));
                        if (loc.path === pathname.split('?')[0] || loc.path.endsWith(pathname.split('?')[0])) break;
                        await sleep(40);
                    }
                    recordStep('action', kind, started, true, pathname);
                    continue;
                }
                if (kind === 'mount') {
                    if (useServe) throw new Error('mount is for Direct harness only (not serve-host)');
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
                    recordStep('action', kind, started, true);
                    continue;
                }
                if (kind === 'click' || kind === 'fill' || kind === 'press' || kind === 'select') {
                    const parsed = parseActionLocator(a);
                    for (const w of parsed.warnings) {
                        diagnostics.push({ severity: 'warning', message: w });
                    }
                    let locator = parsed.locator;
                    if (!locator && kind === 'click') locator = defaultClickLocator();
                    if (!locator) {
                        fail(`${kind}: locator or legacy selector required`);
                        stepOk = false;
                        recordStep('action', kind, started, false);
                        continue;
                    }
                    const timeoutMs = Number(a.timeoutMs) > 0 ? Number(a.timeoutMs) : 8000;
                    const force = a.force === true;
                    await waitForLocator(page, locator, { timeoutMs, force });
                    if (kind === 'click') await clickTarget(page);
                    else if (kind === 'fill') await fillTarget(page, a.value);
                    else if (kind === 'press') await pressTarget(page, a.key ?? a.value ?? 'Enter');
                    else await selectTarget(page, a.value ?? a.option, { timeoutMs, force });
                    recordStep('action', kind, started, true);
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
                    recordStep('action', kind, started, true);
                    continue;
                }
                if (kind === 'flush') {
                    await page.evaluate(async () => {
                        const ctx = (window as any).__vmzBrowser;
                        if (!ctx.inst) throw new Error('flush before mount');
                        await ctx.dom.flushPending(ctx.inst);
                    });
                    recordStep('action', kind, started, true);
                    continue;
                }
                if (kind === 'destroy') {
                    await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        if (!ctx.inst) throw new Error('destroy before mount');
                        ctx.dom.destroy(ctx.inst);
                    });
                    recordStep('action', kind, started, true);
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
                    recordStep('action', kind, started, ok);
                    continue;
                }
                if (kind === 'precision_reset') {
                    await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        if (typeof ctx.dom.__vmzPrecisionEnable === 'function') ctx.dom.__vmzPrecisionEnable(true);
                        if (typeof ctx.dom.__vmzPrecisionReset === 'function') ctx.dom.__vmzPrecisionReset();
                    });
                    recordStep('action', kind, started, true);
                    continue;
                }
                fail(`unknown browser action ${JSON.stringify(kind)}`);
                stepOk = false;
                recordStep('action', kind, started, false);
            } catch (e) {
                stepOk = false;
                recordStep('action', kind, started, false, e instanceof Error ? e.message : String(e));
                fail(`action ${kind}: ${e instanceof Error ? e.message : String(e)}`);
            }
            void stepOk;
        }

        const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
        for (const raw of assertions) {
            const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const kind = String(a.kind || '');
            const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};
            const started = Date.now();
            let stepOk = true;
            try {
                if (kind === 'text') {
                    const timeoutMs = Number(a.timeoutMs ?? expect.timeoutMs) > 0 ? Number(a.timeoutMs ?? expect.timeoutMs) : 8000;
                    const deadline = Date.now() + timeoutMs;
                    let text = '';
                    while (Date.now() <= deadline) {
                        text = await pageText(page);
                        if (expect.equals != null && text === String(expect.equals)) break;
                        if (expect.contains != null && text.includes(String(expect.contains))) break;
                        if (expect.equals == null && expect.contains == null) break;
                        await sleep(40);
                    }
                    if (expect.equals != null && text !== String(expect.equals)) {
                        fail(`text equals want ${JSON.stringify(expect.equals)}, got ${JSON.stringify(text)}`);
                        stepOk = false;
                    }
                    if (expect.contains != null && !text.includes(String(expect.contains))) {
                        fail(`text contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(text)}`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'route') {
                    const timeoutMs = Number(a.timeoutMs ?? expect.timeoutMs) > 0 ? Number(a.timeoutMs ?? expect.timeoutMs) : 8000;
                    const deadline = Date.now() + timeoutMs;
                    let loc = { path: '', href: '' };
                    const wantPath = expect.path != null ? String(expect.path) : null;
                    const wantContains = expect.pathContains != null ? String(expect.pathContains) : null;
                    const wantRouteId = expect.routeId != null ? String(expect.routeId) : null;
                    while (Date.now() <= deadline) {
                        loc = await page.evaluate(() => ({ path: location.pathname, href: location.href }));
                        let ok = true;
                        if (wantPath != null && loc.path !== wantPath) ok = false;
                        if (wantContains != null && !loc.path.includes(wantContains) && !loc.href.includes(wantContains)) ok = false;
                        if (wantRouteId != null) {
                            const hit = await page.evaluate((id: string) => {
                                const el = document.querySelector(`[data-vmz-route="${CSS.escape(id)}"]`);
                                return !!el;
                            }, wantRouteId);
                            if (!hit && loc.path) {
                                try {
                                    const resolved = resolveRoutePath(ctx.outDir, { routeId: wantRouteId });
                                    if (loc.path !== resolved && !loc.path.endsWith(resolved)) ok = false;
                                    else ok = true;
                                } catch {
                                    ok = hit;
                                }
                            } else if (!hit) ok = false;
                        }
                        if (ok) break;
                        await sleep(40);
                    }
                    if (wantPath != null && loc.path !== wantPath) {
                        fail(`route.path want ${wantPath}, got ${loc.path}`);
                        stepOk = false;
                    }
                    if (wantContains != null && !loc.path.includes(wantContains) && !loc.href.includes(wantContains)) {
                        fail(`route.pathContains want ${wantContains}, got ${loc.path}`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk, loc.path);
                    continue;
                }
                if (kind === 'visible' || kind === 'count' || kind === 'value') {
                    const fromAssert = parseActionLocator({
                        locator: a.locator ?? expect.locator,
                        selector: a.selector ?? expect.selector,
                    } as Record<string, unknown>);
                    for (const w of fromAssert.warnings) {
                        diagnostics.push({ severity: 'warning', message: w });
                    }
                    if (!fromAssert.locator) {
                        fail(`${kind}: locator or legacy selector required`);
                        recordStep('assertion', kind, started, false);
                        continue;
                    }
                    const timeoutMs = Number(a.timeoutMs ?? expect.timeoutMs) > 0 ? Number(a.timeoutMs ?? expect.timeoutMs) : 8000;
                    const deadline = Date.now() + timeoutMs;
                    let last: { ok?: boolean; count?: number; reason?: string; value?: string | null } = {};
                    while (Date.now() <= deadline) {
                        last = await page.evaluate(resolveLocatorInPage, fromAssert.locator, { force: true });
                        if (kind === 'visible') {
                            if (Number(last?.count) >= 1) break;
                        } else if (kind === 'count') {
                            const want = Number(expect.equals ?? expect.count);
                            if (Number.isFinite(want) && Number(last?.count) === want) break;
                        } else if (kind === 'value') {
                            if (last?.ok && last.count === 1) {
                                const val = await page.evaluate(() => {
                                    const el = document.querySelector('[data-vmz-bh-target="1"]') as
                                        | HTMLInputElement
                                        | HTMLTextAreaElement
                                        | HTMLSelectElement
                                        | null;
                                    return el ? String(el.value) : null;
                                });
                                last.value = val;
                                if (expect.equals != null && val === String(expect.equals)) break;
                                if (expect.contains != null && val != null && val.includes(String(expect.contains))) break;
                                if (expect.equals == null && expect.contains == null) break;
                            }
                        } else break;
                        await sleep(40);
                    }
                    if (kind === 'visible') {
                        if (!(Number(last?.count) >= 1)) {
                            fail(`visible: ${last?.reason || 'not found'} ${JSON.stringify(fromAssert.locator)}`);
                            stepOk = false;
                        }
                    } else if (kind === 'count') {
                        const want = Number(expect.equals ?? expect.count);
                        if (!Number.isFinite(want) || Number(last?.count) !== want) {
                            fail(`count want ${want}, got ${last?.count} (${last?.reason || ''})`);
                            stepOk = false;
                        }
                    } else if (kind === 'value') {
                        const val =
                            last.value ??
                            (await page.evaluate(() => {
                                const el = document.querySelector('[data-vmz-bh-target="1"]') as HTMLInputElement | null;
                                return el ? String(el.value) : null;
                            }));
                        if (expect.equals != null && val !== String(expect.equals)) {
                            fail(`value equals want ${JSON.stringify(expect.equals)}, got ${JSON.stringify(val)}`);
                            stepOk = false;
                        }
                        if (expect.contains != null && (val == null || !String(val).includes(String(expect.contains)))) {
                            fail(`value contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(val)}`);
                            stepOk = false;
                        }
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'nodeIdentity') {
                    const sel = typeof expect.selector === 'string' ? expect.selector : 'button';
                    const same = await page.evaluate((s: string) => {
                        const ctx = (window as any).__vmzBrowser;
                        const after = ctx.app.querySelector(s);
                        return !!(ctx.buttonBefore && after && after === ctx.buttonBefore);
                    }, sel);
                    if (!same) {
                        fail(`nodeIdentity failed for ${sel} (real browser document)`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
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
                            stepOk = false;
                        }
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'host') {
                    if (expect.kind === 'browser' || expect.realDocument === true) {
                        const ok = await page.evaluate(() => typeof document !== 'undefined' && !!(document as any).createElement);
                        if (!ok) {
                            fail('host.realDocument failed');
                            stepOk = false;
                        }
                    }
                    if (expect.serveHost === true && !useServe) {
                        fail('host.serveHost expected but manifest used static harness');
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'destroyed') {
                    const want = expect.value !== false;
                    const got = await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        return Boolean(ctx.inst?.__vmzDestroyed);
                    });
                    if (got !== want) {
                        fail(`__vmzDestroyed want ${want}, got ${got}`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'childDestroyed') {
                    const want = expect.value !== false;
                    const got = await page.evaluate(() => {
                        const ctx = (window as any).__vmzBrowser;
                        if (!ctx.capturedChild) return null;
                        return Boolean(ctx.capturedChild.__vmzDestroyed);
                    });
                    if (got == null) {
                        fail('childDestroyed: no captured child (use capture_child action)');
                        stepOk = false;
                    } else if (got !== want) {
                        fail(`child __vmzDestroyed want ${want}, got ${got}`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
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
                        recordStep('assertion', kind, started, false);
                        continue;
                    }
                    if (expect.minWrites != null && Number(snap.writes || 0) < Number(expect.minWrites)) {
                        fail(`precision.writes want >= ${expect.minWrites}, got ${snap.writes}`);
                        stepOk = false;
                    }
                    if (expect.maxWrites != null && Number(snap.writes || 0) > Number(expect.maxWrites)) {
                        fail(`precision.writes want <= ${expect.maxWrites}, got ${snap.writes}`);
                        stepOk = false;
                    }
                    if (expect.maxBindingEvals != null && Number(snap.bindingEvals || 0) > Number(expect.maxBindingEvals)) {
                        fail(`precision.bindingEvals want <= ${expect.maxBindingEvals}, got ${snap.bindingEvals}`);
                        stepOk = false;
                    }
                    if (expect.maxPatchExecs != null && Number(snap.patchExecs || 0) > Number(expect.maxPatchExecs)) {
                        fail(`precision.patchExecs want <= ${expect.maxPatchExecs}, got ${snap.patchExecs}`);
                        stepOk = false;
                    }
                    if (expect.patchesIncludeDep != null) {
                        const dep = String(expect.patchesIncludeDep);
                        const map = (snap.patchesByDep as Record<string, number>) || {};
                        if (!map[dep]) {
                            fail(`precision.patchesByDep missing ${dep}: ${JSON.stringify(map)}`);
                            stepOk = false;
                        }
                    }
                    if (expect.writesIncludeRoot != null) {
                        const rootKey = String(expect.writesIncludeRoot);
                        const map = (snap.writesByRoot as Record<string, number>) || {};
                        if (!map[rootKey]) {
                            fail(`precision.writesByRoot missing ${rootKey}: ${JSON.stringify(map)}`);
                            stepOk = false;
                        }
                    }
                    if (expect.domCreates === 0 || expect.domCreates === false) {
                        if (Number(snap.domCreates || 0) !== 0) {
                            fail(`precision.domCreates want 0 after action window, got ${snap.domCreates}`);
                            stepOk = false;
                        }
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'timing') {
                    // Presence of step timings is enough for thin evidence gate.
                    if (!stepTimings.length) {
                        fail('timing: no recorded steps');
                        stepOk = false;
                    }
                    if (expect.minSteps != null && stepTimings.length < Number(expect.minSteps)) {
                        fail(`timing.minSteps want >= ${expect.minSteps}, got ${stepTimings.length}`);
                        stepOk = false;
                    }
                    recordStep('assertion', kind, started, stepOk);
                    continue;
                }
                if (kind === 'graph' || kind === 'plan' || kind === 'diagnostic' || kind === 'view' || kind === 'motion') {
                    recordStep('assertion', kind, started, true);
                    continue;
                }
                fail(`unknown browser assertion ${JSON.stringify(kind)}`);
                recordStep('assertion', kind, started, false);
            } catch (e) {
                recordStep('assertion', kind, started, false, e instanceof Error ? e.message : String(e));
                fail(`assertion ${kind}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        if (failOnConsoleError && consoleErrors.length) {
            fail(`console errors (${consoleErrors.length}): ${consoleErrors.slice(0, 3).join(' | ')}`);
        }
        if (failOnRequestFailed && failedRequests.length) {
            fail(`request failed (${failedRequests.length}): ${failedRequests.slice(0, 3).join(' | ')}`);
        }
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
    } finally {
        const timing: BrowserTiming = {
            schema: 'vmz.test.browser.timing.v0',
            totalMs: Date.now() - runStarted,
            steps: stepTimings,
        };
        const failed = diagnostics.some((d) => d.severity === 'error');
        try {
            if (failed && page) {
                const paths = await writeFailureEvidence(page, artifactsDir, timing);
                diagnostics.push({
                    severity: 'info',
                    message: `browser evidence: ${paths.timing || ''}${paths.screenshot ? `; screenshot ${paths.screenshot}` : ''}`,
                });
            } else {
                const timingPath = writeTimingOnly(artifactsDir, timing);
                diagnostics.push({ severity: 'info', message: `browser timing: ${timingPath}` });
            }
        } catch (e) {
            diagnostics.push({
                severity: 'warning',
                message: `evidence write failed: ${e instanceof Error ? e.message : String(e)}`,
            });
        }
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
        try {
            if (serveHost) serveHost.kill();
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

/**
 * Auto-wait until locator resolves to exactly one actionable element.
 */
async function waitForLocator(
    page: { evaluate: (...args: unknown[]) => Promise<unknown> },
    locator: BrowserLocator,
    opts: { timeoutMs?: number; force?: boolean } = {},
): Promise<LocatorResolveResult> {
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
    const force = opts.force === true;
    const deadline = Date.now() + timeoutMs;
    let last: LocatorResolveResult = {
        ok: false,
        count: 0,
        actionable: false,
        reason: 'not attempted',
        index: -1,
    };
    while (Date.now() <= deadline) {
        last = (await page.evaluate(resolveLocatorInPage, locator, { force })) as LocatorResolveResult;
        if (last && last.ok && last.actionable && last.count === 1) return last;
        await sleep(40);
    }
    throw new Error(`locator timeout (${timeoutMs}ms): ${last?.reason || 'unknown'} count=${last?.count ?? 0} ${JSON.stringify(locator)}`);
}

async function clickTarget(page: { evaluate: (...args: unknown[]) => Promise<unknown> }): Promise<void> {
    const ok = await page.evaluate(() => {
        const el = document.querySelector('[data-vmz-bh-target="1"]') as HTMLElement | null;
        if (!el) return false;
        el.focus();
        el.click();
        return true;
    });
    if (!ok) throw new Error('click: resolved target missing in document');
}

async function fillTarget(page: { evaluate: (...args: unknown[]) => Promise<unknown> }, value: unknown): Promise<void> {
    const ok = await page.evaluate((v: unknown) => {
        const el = document.querySelector('[data-vmz-bh-target="1"]') as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return false;
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, String(v));
        else el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, value);
    if (!ok) throw new Error('fill: resolved target missing or not an input');
}

async function pressTarget(page: { evaluate: (...args: unknown[]) => Promise<unknown> }, key: unknown): Promise<void> {
    const ok = await page.evaluate((k: unknown) => {
        const el = (document.querySelector('[data-vmz-bh-target="1"]') as HTMLElement | null) || (document.activeElement as HTMLElement | null);
        if (!el) return false;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: String(k), bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: String(k), bubbles: true }));
        return true;
    }, key);
    if (!ok) throw new Error('press: no target/focused element');
}

async function pageText(page: { evaluate: (...args: unknown[]) => Promise<unknown> }): Promise<string> {
    return (await page.evaluate(() => {
        const ctx = (window as any).__vmzBrowser;
        if (ctx?.app) return ctx.app.textContent || '';
        return document.body?.innerText || document.body?.textContent || '';
    })) as string;
}

/**
 * Native <select> or listbox/combobox (data-vmz-option / role=option).
 * Prefer option value (data-vmz-option) then accessible name/label.
 */
async function selectTarget(
    page: {
        evaluate: (...args: unknown[]) => Promise<unknown>;
    },
    value: unknown,
    opts: { timeoutMs?: number; force?: boolean } = {},
): Promise<void> {
    const want = String(value ?? '');
    if (!want) throw new Error('select: value/option required');
    const native = await page.evaluate((v: string) => {
        const el = document.querySelector('[data-vmz-bh-target="1"]') as HTMLSelectElement | HTMLElement | null;
        if (!el) return { ok: false, reason: 'missing target' };
        if (el instanceof HTMLSelectElement) {
            el.focus();
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, kind: 'native' };
        }
        // Custom combobox/listbox: open if needed, then click option.
        const expanded = el.getAttribute('aria-expanded');
        if (expanded !== 'true') el.click();
        return { ok: true, kind: 'custom' };
    }, want);
    if (!native || !(native as { ok?: boolean }).ok) {
        throw new Error(`select: ${(native as { reason?: string })?.reason || 'failed'}`);
    }
    if ((native as { kind?: string }).kind === 'native') return;

    // Prefer stable option value contract, then accessible name.
    const byValue: BrowserLocator = { kind: 'css', selector: `[data-vmz-option="${want.replace(/"/g, '\\"')}"]` };
    try {
        await waitForLocator(page, byValue, opts);
        await clickTarget(page);
        return;
    } catch {
        /* fall through to role=option name */
    }
    const optionLocator: BrowserLocator = { kind: 'role', role: 'option', name: want };
    await waitForLocator(page, optionLocator, opts);
    await clickTarget(page);
}

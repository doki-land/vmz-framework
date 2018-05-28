/**
 * Minimal puppeteer-core + system Chrome smoke for CI.
 * Usage: CHROME_PATH=/path/to/chrome node scripts/chrome-smoke.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const chrome = process.env.CHROME_PATH || process.env.VMZ_BROWSER || process.env.PUPPETEER_EXECUTABLE_PATH;
if (!chrome) {
    console.error('chrome-smoke: set CHROME_PATH');
    process.exit(2);
}

const mod = await import('puppeteer-core');
const puppeteer = mod.default ?? mod;
if (typeof puppeteer?.launch !== 'function' || typeof puppeteer?.connect !== 'function') {
    console.error('chrome-smoke: puppeteer-core.launch/connect missing');
    process.exit(2);
}

const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--font-render-hinting=none',
    '--mute-audio',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--no-first-run',
    '--metrics-recording-only',
];

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function waitPort(port, ms = 20_000) {
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

async function exercise(browser, label) {
    const version = await browser.version();
    await sleep(200);
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    await page.setContent('<!DOCTYPE html><h1 id="ok">ok</h1>', { waitUntil: 'domcontentloaded' });
    const text = await page.$eval('#ok', (el) => el.textContent);
    console.log(`puppeteer smoke ok (${label}) version=${version} text=${text}`);
}

function gha(kind, message) {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::${kind} title=chrome-smoke::${String(message).replace(/[\r\n]+/g, ' ')}`);
    }
}

async function tryConnectRemote(label, extraArgs = []) {
    console.log(`chrome-smoke: trying ${label}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-chrome-'));
    const port = 9200 + Math.floor(Math.random() * 700);
    const args = [...baseArgs, ...extraArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'];
    let stderr = '';
    const child = spawn(chrome, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: dir },
    });
    child.stderr.on('data', (b) => {
        stderr += String(b);
    });
    child.stdout.on('data', () => {});
    let exitCode = null;
    child.on('exit', (code) => {
        exitCode = code;
    });
    try {
        await waitPort(port);
        const browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${port}`,
            protocolTimeout: 60_000,
        });
        try {
            await exercise(browser, label);
        } finally {
            try {
                await browser.disconnect();
            } catch {
                /* ignore */
            }
        }
    } finally {
        try {
            child.kill('SIGKILL');
        } catch {
            /* ignore */
        }
        await sleep(50);
        fs.rmSync(dir, { recursive: true, force: true });
        if (exitCode != null && exitCode !== 0) {
            console.error(`chrome-smoke: ${label} chrome exit=${exitCode}`);
        }
        if (stderr.trim()) {
            console.error(`chrome-smoke: ${label} chrome stderr:\n${stderr.slice(-2500)}`);
        }
    }
}

async function tryLaunch(label, opts) {
    console.log(`chrome-smoke: trying ${label}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-chrome-'));
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        protocolTimeout: 60_000,
        dumpio: process.env.VMZ_BROWSER_DEBUG === '1',
        ...opts,
        args: [...(opts.args || []), `--user-data-dir=${dir}`],
    });
    try {
        await exercise(browser, label);
    } finally {
        await browser.close().catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const attempts = [
    () => tryConnectRemote('spawn+connect headless=new', ['--headless=new']),
    () => tryConnectRemote('spawn+connect headless=old', ['--headless=old']),
    () => tryLaunch('launch pipe', { pipe: true, args: [...baseArgs, '--headless=new'] }),
    () => tryLaunch('launch ws', { pipe: false, args: [...baseArgs, '--headless=new'] }),
    () =>
        tryLaunch('launch pipe+single-process', {
            pipe: true,
            args: [...baseArgs, '--headless=new', '--single-process'],
        }),
];

let lastErr;
for (const run of attempts) {
    try {
        await run();
        gha('notice', 'ok');
        process.exit(0);
    } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`chrome-smoke: attempt failed: ${msg}`);
        gha('warning', msg);
    }
}

const finalMsg = `all attempts failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`;
console.error(`chrome-smoke: ${finalMsg}`);
gha('error', finalMsg);
process.exit(1);

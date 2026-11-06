/**
 * chart-hydration-stability — the `/charts` SSR SVG subtree must be reused by
 * hydration instead of being rebuilt.
 *
 * Regression for the chart cache that became reactive during hydration and
 * re-rendered the whole chart scene. Every parser-created SVG is marked before
 * deferred client modules run, then the marker survival ratio is measured.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv, serveHostProjectEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const homepage = path.join(root, 'packages', 'homepage');
const dist = path.join(homepage, 'dist', 'web-ssr');
const PORT = 18784;

function fail(msg: string): never {
    console.error(`chart-hydration-stability GATE FAIL: ${msg}`);
    process.exit(1);
}

const build = spawnSync(process.execPath, [vmzBin(root), 'build', homepage], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serveHostChildEnv(),
});
if ((build.status ?? 1) !== 0) {
    fail(`homepage build failed\n${build.stdout}\n${build.stderr}`);
}
const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail(`missing ${hostJs}`);

const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
const puppeteer = requireFromTest('puppeteer-core');
const { resolveBrowserExecutable } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
);
const chrome = resolveBrowserExecutable();
if (!chrome) fail('Chrome/Edge not found for chart hydration (set VMZ_BROWSER)');

const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostProjectEnv(homepage, {
        VMZ_DIST: dist,
        VMZ_HOST: '127.0.0.1',
        VMZ_PORT: String(PORT),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
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

    const warm = await fetch(`http://127.0.0.1:${PORT}/charts`);
    if (!warm.ok) fail(`warm GET /charts failed: ${warm.status}`);

    browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
        const win = window as any;
        win.__vmzSvgMarks = 0;
        const tag = (node: any) => {
            if (!node || node.nodeType !== 1) return;
            if (node.tagName?.toLowerCase() === 'svg' && !node.__vmzSsrSvg) {
                node.__vmzSsrSvg = 1;
                win.__vmzSvgMarks += 1;
            }
            for (const el of node.querySelectorAll?.('svg') ?? []) {
                if (!el.__vmzSsrSvg) {
                    el.__vmzSsrSvg = 1;
                    win.__vmzSvgMarks += 1;
                }
            }
        };
        new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) tag(node);
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`http://127.0.0.1:${PORT}/charts`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stats = await page.evaluate(() => {
        const win = window as any;
        const svgs = Array.from(document.querySelectorAll('svg')) as any[];
        return {
            total: svgs.length,
            marked: svgs.filter((svg) => svg.__vmzSsrSvg).length,
            created: win.__vmzSvgMarks ?? 0,
        };
    });
    if (stats.total < 20) fail(`/charts rendered too few SVG nodes: ${JSON.stringify(stats)}`);
    if (stats.created < stats.total) fail(`marker saw fewer SVGs than the final DOM: ${JSON.stringify(stats)}`);
    const ratio = stats.marked / stats.total;
    if (ratio < 0.9) {
        fail(`hydration rebuilt the chart subtree: ${JSON.stringify(stats)} reuse=${(ratio * 100).toFixed(1)}%`);
    }
    console.log(`chart-hydration-stability: svg=${stats.total} reused=${stats.marked} (${(ratio * 100).toFixed(1)}%)`);
} finally {
    if (browser) await browser.close();
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

console.log('chart-hydration-stability PASS');

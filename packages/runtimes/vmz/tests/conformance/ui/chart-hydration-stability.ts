/**
 * chart-hydration-stability — chart SSR ownership follows build-time size
 * certainty.
 *
 * A responsive chart cannot know its container width while the page is
 * serialized. Emitting a fallback-width SVG there guarantees a rebuild once
 * `ResizeObserver` reports the real width, so the responsive body is
 * client-owned and SSR carries no SVG inside chart hosts. A fixed-size chart
 * (and the diagram, whose scene size comes from the spec) still serializes its
 * SVG and hydration must adopt that exact node instead of rebuilding it.
 *
 * Evidence: `/charts` SSR HTML has zero SVG inside `vmz-ui-charts__chart`
 * hosts, and the diagram keeps its parser-created SVG after hydration.
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
    const ssrHtml = await warm.text();
    const svgHosts = Array.from(ssrHtml.matchAll(/class="vmz-ui-charts__svg"[^>]*>([\s\S]*?)<\/div>/g));
    const ssrChartHosts = (ssrHtml.match(/data-vmz-ui-charts="chart"/g) || []).length;
    const ssrDiagramHosts = (ssrHtml.match(/data-vmz-ui-charts="diagram"/g) || []).length;
    const ssrHostsWithSvg = svgHosts.filter((match) => match[1].includes('<svg')).length;
    const ssrSvgBytes = svgHosts.reduce((n, match) => n + (match[1].includes('<svg') ? match[1].length : 0), 0);
    if (ssrChartHosts < 40) fail(`/charts SSR rendered too few chart hosts: ${ssrChartHosts}`);
    if (ssrDiagramHosts < 1) fail(`/charts SSR rendered no diagram host: ${ssrDiagramHosts}`);
    if (ssrHostsWithSvg !== ssrDiagramHosts) {
        fail(
            `responsive chart hosts must not serialize SVG: hosts=${svgHosts.length} withSvg=${ssrHostsWithSvg} diagrams=${ssrDiagramHosts}`,
        );
    }

    browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
        const win = window as any;
        win.__vmzSvgCreated = 0;
        win.__vmzSvgParsed = 0;
        const classify = (node: any) => {
            if (!node || node.nodeType !== 1) return;
            const svgs: any[] = [];
            if (node.tagName?.toLowerCase() === 'svg') svgs.push(node);
            for (const el of node.querySelectorAll?.('svg') ?? []) svgs.push(el);
            for (const svg of svgs) {
                if (svg.__vmzSvgSeen) continue;
                svg.__vmzSvgSeen = 1;
                if (document.readyState === 'loading') {
                    svg.__vmzSsrSvg = 1;
                    win.__vmzSvgParsed += 1;
                } else {
                    win.__vmzSvgCreated += 1;
                    const host = svg.closest?.('.vmz-ui-charts__svg');
                    if (host) host.__vmzSvgCreated = (host.__vmzSvgCreated ?? 0) + 1;
                }
            }
        };
        new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) classify(node);
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`http://127.0.0.1:${PORT}/charts`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stats = await page.evaluate(() => {
        const win = window as any;
        const collect = (selector: string) => {
            const hosts = Array.from(document.querySelectorAll(selector)) as any[];
            return hosts.map((host) => {
                const svgs = Array.from(host.querySelectorAll('svg')) as any[];
                return {
                    count: svgs.length,
                    reused: svgs.filter((svg) => svg.__vmzSsrSvg).length,
                    created: host.__vmzSvgCreated ?? 0,
                };
            });
        };
        return {
            created: win.__vmzSvgCreated ?? 0,
            parsed: win.__vmzSvgParsed ?? 0,
            charts: collect('.vmz-ui-charts__chart .vmz-ui-charts__svg'),
            diagrams: collect('.vmz-ui-charts__diagram .vmz-ui-charts__svg'),
        };
    });
    const chartHosts = stats.charts.length;
    const chartSvgCount = stats.charts.reduce((n, host) => n + host.count, 0);
    const chartReused = stats.charts.reduce((n, host) => n + host.reused, 0);
    const chartCreated = stats.charts.reduce((n, host) => n + host.created, 0);
    const singleSvgCharts = stats.charts.filter((host) => host.count === 1).length;
    const diagramSvgCount = stats.diagrams.reduce((n, host) => n + host.count, 0);
    const diagramReused = stats.diagrams.reduce((n, host) => n + host.reused, 0);
    const diagramCreated = stats.diagrams.reduce((n, host) => n + host.created, 0);
    if (chartHosts < 40) fail(`/charts hydrated too few chart hosts: ${chartHosts}`);
    if (singleSvgCharts !== chartHosts) {
        fail(`each chart host must own exactly one SVG: ${JSON.stringify(stats.charts.slice(0, 5))}`);
    }
    if (chartSvgCount !== chartHosts) fail(`chart SVG count mismatch: hosts=${chartHosts} svg=${chartSvgCount}`);
    if (chartReused !== 0) fail(`responsive charts must rebuild from the client: reused=${chartReused}`);
    if (chartCreated !== chartHosts) {
        fail(`chart bodies must be created exactly once: created=${chartCreated} hosts=${chartHosts}`);
    }
    if (stats.diagrams.length < 1) fail(`/charts hydrated no diagram host: ${stats.diagrams.length}`);
    if (diagramSvgCount !== stats.diagrams.length || diagramReused !== stats.diagrams.length) {
        const detail = await page.evaluate(() => {
            const host = document.querySelector('.vmz-ui-charts__diagram .vmz-ui-charts__svg') as any;
            const svg = host?.querySelector('svg') as any;
            return {
                hash: host?.getAttribute('data-vmz-html-hash') ?? null,
                full: svg ? String(svg.outerHTML) : null,
                parsedGlobal: (window as any).__vmzSvgParsed ?? 0,
            };
        });
        const ssrDiagram = ssrHtml.match(/data-vmz-ui-charts="diagram"[\s\S]*?class="vmz-ui-charts__svg"[^>]*>([\s\S]*?)<\/div>/);
        const ssrHash = ssrDiagram
            ? (ssrDiagram[0].match(/data-vmz-html-hash="([^"]+)"/)?.[1] ?? null)
            : null;
        const ssrSvg = ssrDiagram ? ssrDiagram[1].trim() : null;
        fail(
            `fixed-size diagram SVG must be adopted, not rebuilt: hosts=${stats.diagrams.length} svg=${diagramSvgCount} reused=${diagramReused} ` +
                `created=${diagramCreated} ssrHash=${ssrHash} clientHash=${detail.hash} parsed=${detail.parsedGlobal} ` +
                `ssrLen=${ssrSvg?.length ?? -1} clientLen=${detail.full?.length ?? -1}`,
        );
    }
    if (diagramCreated !== 0) fail(`diagram SVG must not be recreated: created=${diagramCreated}`);
    console.log(
        `chart-hydration-stability: ssr bytes=${ssrHtml.length} chartHosts=${ssrChartHosts} ssrChartSvg=${ssrHostsWithSvg - ssrDiagramHosts} ssrSvgBytes=${ssrSvgBytes} ` +
            `hydrated chartSvg=${chartSvgCount} created=${chartCreated} diagramReused=${diagramReused}/${stats.diagrams.length}`,
    );
} finally {
    if (browser) await browser.close();
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

console.log('chart-hydration-stability PASS');

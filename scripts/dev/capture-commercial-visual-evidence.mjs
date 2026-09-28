import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveNativePath } from 'vmz';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOMEPAGE = path.join(ROOT, 'packages', 'homepage');
const OUT_DIR = path.join(HOMEPAGE, 'evidence', 'commercial-visual');
const PORT = Number(process.env.VMZ_EVIDENCE_PORT || 18821);
const HOST = process.env.VMZ_EVIDENCE_HOST || '127.0.0.1';

const VIEWPORTS = [
    { id: '1440x900', width: 1440, height: 900 },
    { id: '1024x768', width: 1024, height: 768 },
    { id: '390x844', width: 390, height: 844, isMobile: true },
];

const PAGES = [
    { id: 'home', path: '/' },
    { id: 'console', path: '/console' },
    { id: 'commercial', path: '/commercial' },
];

function resolveDist() {
    const nested = path.join(HOMEPAGE, 'dist', 'web-ssr');
    if (fs.existsSync(path.join(nested, 'vmz-serve-host.mjs'))) return nested;
    const flat = path.join(HOMEPAGE, 'dist');
    if (fs.existsSync(path.join(flat, 'vmz-serve-host.mjs'))) return flat;
    throw new Error('homepage dist missing vmz-serve-host.mjs, run `pnpm --filter @vmz/homepage build`');
}

function ensureBuild() {
    const dist = resolveDist();
    if (process.env.SKIP_BUILD === '1') return dist;
    console.log('capture-commercial-visual-evidence: building homepage…');
    const r = spawnSync('pnpm', ['--filter', '@vmz/homepage', 'build'], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true,
    });
    if (r.status !== 0) {
        console.error(r.stdout || r.stderr || 'homepage build failed');
        process.exit(1);
    }
    return resolveDist();
}

async function loadBrowser() {
    const requireFromTest = createRequire(path.join(ROOT, 'packages', 'runtimes', 'vmz-test', 'package.json'));
    const mod = requireFromTest('puppeteer-core');
    const puppeteer = mod?.default ?? mod;
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(ROOT, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found, set VMZ_BROWSER');
    return { puppeteer, chrome };
}

async function waitForServer(baseUrl) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/`);
            if (res.ok) return;
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`serve host did not become ready at ${baseUrl}`);
}

async function capturePage(page, baseUrl, pageDef, viewport, outDir, manifest) {
    const url = `${baseUrl}${pageDef.path}`;
    await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        isMobile: !!viewport.isMobile,
        deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90_000 });
    await page.waitForSelector('[data-vmz-fixture="site-header"], [data-vmz-ui="console-shell"], [data-vmz-ui="app-shell"]', {
        timeout: 20_000,
    });
    const metrics = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        path: location.pathname,
    }));
    const file = `${pageDef.id}-${viewport.id}.png`;
    const shotPath = path.join(outDir, file);
    await page.screenshot({ path: shotPath, fullPage: false });
    manifest.push({
        page: pageDef.id,
        viewport: viewport.id,
        url,
        file,
        innerWidth: metrics.innerWidth,
        scrollWidth: metrics.scrollWidth,
        horizontalOverflow: metrics.scrollWidth > metrics.innerWidth,
    });
    console.log(`wrote ${path.relative(ROOT, shotPath)} (${metrics.innerWidth}px inner, scroll ${metrics.scrollWidth}px)`);
}

async function captureNoJsHome(baseUrl, outDir, manifest, chromePath, puppeteer) {
    const viewport = VIEWPORTS[0];
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.setJavaScriptEnabled(false);
        await page.setViewport({
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
        });
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        const metrics = await page.evaluate(() => ({
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
        }));
        const file = `home-${viewport.id}-nojs.png`;
        const shotPath = path.join(outDir, file);
        await page.screenshot({ path: shotPath, fullPage: false });
        manifest.push({
            page: 'home',
            viewport: viewport.id,
            url: `${baseUrl}/`,
            file,
            js: false,
            innerWidth: metrics.innerWidth,
            scrollWidth: metrics.scrollWidth,
            horizontalOverflow: metrics.scrollWidth > metrics.innerWidth,
        });
        console.log(`wrote ${path.relative(ROOT, shotPath)} (JS disabled)`);
    } finally {
        await browser.close();
    }
}

async function main() {
    const dist = ensureBuild();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    const baseUrl = `http://${HOST}:${PORT}`;
    const { puppeteer, chrome } = await loadBrowser();

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

    const manifest = {
        generatedAt: new Date().toISOString(),
        baseUrl,
        dist: path.relative(ROOT, dist),
        shots: [],
    };

    try {
        await waitForServer(baseUrl);
        const browser = await puppeteer.launch({
            executablePath: chrome,
            headless: true,
            args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        });
        try {
            const page = await browser.newPage();
            for (const viewport of VIEWPORTS) {
                for (const pageDef of PAGES) {
                    await capturePage(page, baseUrl, pageDef, viewport, OUT_DIR, manifest.shots);
                }
            }
            await captureNoJsHome(baseUrl, OUT_DIR, manifest.shots, chrome, puppeteer);
        } finally {
            await browser.close();
        }
    } finally {
        child.kill('SIGTERM');
    }

    const manifestPath = path.join(OUT_DIR, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const overflow = manifest.shots.filter((s) => s.horizontalOverflow);
    if (overflow.length) {
        console.warn(`capture-commercial-visual-evidence: ${overflow.length} shot(s) report horizontal overflow`);
        for (const row of overflow) {
            console.warn(`  ${row.page} @ ${row.viewport}: scrollWidth ${row.scrollWidth} > innerWidth ${row.innerWidth}`);
        }
    }
    console.log(`capture-commercial-visual-evidence: manifest ${path.relative(ROOT, manifestPath)}`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});

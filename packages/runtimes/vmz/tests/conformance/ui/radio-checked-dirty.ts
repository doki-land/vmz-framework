/**
 * radio-checked-dirty — a radio model update after user input must move the
 * browser's checkedness through IDL, not through the `checked` attribute.
 *
 * Regression for the fix where radio groups used attribute writes and the
 * browser's dirty checkedness flag kept the user-clicked radio selected.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`radio-checked-dirty GATE FAIL: ${msg}`);
    process.exit(1);
}

const distRoot = path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist');
const attributesJs = path.join(distRoot, 'browser', 'dom', 'attributes.js');
if (!fs.existsSync(attributesJs)) fail(`missing ${attributesJs} — run pnpm --filter @vmz/core build`);

const harness = `<!DOCTYPE html><html><body>
<input type="radio" name="pick" id="a" checked>
<input type="radio" name="pick" id="b">
<script type="module">
import { applyDomAttr } from '/browser/dom/attributes.js';
const a = document.getElementById('a');
const b = document.getElementById('b');
b.click();
applyDomAttr(a, 'checked', true);
window.__radio = { a: a.checked, b: b.checked, aAttr: a.hasAttribute('checked'), bAttr: b.hasAttribute('checked') };
window.__ready = true;
</script>
</body></html>`;

const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/harness.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(harness);
        return;
    }
    const abs = path.resolve(distRoot, `.${url.pathname}`);
    if (!abs.startsWith(distRoot + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': mime[path.extname(abs)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(abs));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
const puppeteer = requireFromTest('puppeteer-core');
const { resolveBrowserExecutable } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
);
const chrome = resolveBrowserExecutable();
if (!chrome) {
    server.close();
    fail('Chrome/Edge not found for radio checkedness (set VMZ_BROWSER)');
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 5000 });
    const result = await page.evaluate(() => (window as any).__radio);
    if (!result) fail('harness did not publish __radio');
    if (result.a !== true) fail(`model write did not check radio A through IDL: ${JSON.stringify(result)}`);
    if (result.b !== false) fail(`model write left radio B checked after user input: ${JSON.stringify(result)}`);
} finally {
    await browser.close();
    server.close();
}

console.log('radio-checked-dirty PASS: radio model update wins over dirty checkedness');

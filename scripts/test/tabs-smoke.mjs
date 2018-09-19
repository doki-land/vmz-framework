import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExecutable } from '../../packages/runtimes/vmz-test/dist/browser.js';

const requireFromTest = createRequire(fileURLToPath(new URL('../../packages/runtimes/vmz-test/package.json', import.meta.url)));
const puppeteer = requireFromTest('puppeteer-core');

const PORT = process.env.VMZ_PORT || '18782';
const chrome = resolveBrowserExecutable();
if (!chrome) {
    console.error('no chrome');
    process.exit(1);
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
    await page.goto(`http://127.0.0.1:${PORT}/ui`, { waitUntil: 'networkidle0', timeout: 20000 });
    const before = await page.evaluate(() => ({
        hasUiLab: !!document.querySelector('[data-vmz-fixture="ui-lab"]'),
        tabPanel: document.querySelector('[data-vmz-fixture="tab-panel"]')?.textContent,
        securitySelected: document.querySelector('[data-vmz-tab="home-ui-tab-security"]')?.getAttribute('aria-selected'),
    }));
    console.log('before:', JSON.stringify(before));
    await page.click('[data-vmz-tab="home-ui-tab-security"]');
    try {
        await page.waitForFunction(
            () => document.querySelector('[data-vmz-fixture="tab-panel"]')?.textContent?.includes('home-ui-tab-security'),
            { timeout: 5000 },
        );
        console.log('tabs: PASS');
    } catch {
        const after = await page.evaluate(() => ({
            tabPanel: document.querySelector('[data-vmz-fixture="tab-panel"]')?.textContent,
            securitySelected: document.querySelector('[data-vmz-tab="home-ui-tab-security"]')?.getAttribute('aria-selected'),
        }));
        console.log('tabs: FAIL', JSON.stringify(after));
        process.exitCode = 1;
    }
} catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
}
await browser.close();

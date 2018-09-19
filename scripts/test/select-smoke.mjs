import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExecutable } from '../../packages/runtimes/vmz-test/dist/browser.js';

const requireFromTest = createRequire(fileURLToPath(new URL('../../packages/runtimes/vmz-test/package.json', import.meta.url)));
const puppeteer = requireFromTest('puppeteer-core');

const PORT = process.env.VMZ_PORT || '18784';
const chrome = resolveBrowserExecutable();
if (!chrome) {
    console.error('no chrome');
    process.exit(1);
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
    await page.goto(`http://127.0.0.1:${PORT}/form`, { waitUntil: 'networkidle0', timeout: 20000 });
    const before = await page.evaluate(() => ({
        hasSelect: !!document.querySelector('#home-form-role'),
        expanded: document.querySelector('#home-form-role')?.getAttribute('aria-expanded'),
    }));
    console.log('before:', JSON.stringify(before));
    await page.click('#home-form-role');
    try {
        await page.waitForSelector('[data-vmz-overlay="select"]', { timeout: 5000 });
        console.log('select open: PASS');
        await page.click('[data-vmz-option="ops"]');
        await page.waitForFunction(
            () => document.querySelector('.vmz-ui-select__value')?.textContent?.includes('Operations'),
            { timeout: 5000 },
        );
        console.log('select pick: PASS');
    } catch {
        const after = await page.evaluate(() => ({
            expanded: document.querySelector('#home-form-role')?.getAttribute('aria-expanded'),
            overlay: !!document.querySelector('[data-vmz-overlay="select"]'),
            value: document.querySelector('.vmz-ui-select__value')?.textContent,
        }));
        console.log('select: FAIL', JSON.stringify(after));
        process.exitCode = 1;
    }
} catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
}
await browser.close();

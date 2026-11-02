// Interaction evidence capture for `@vmz/ui-charts` on the built bench.
// Saves DPR=2 screenshots to E:\zzz 中转站\charts-shots\interactions\.
// Usage: `node tests/capture-interactions.mjs [baseUrl]`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('E:/vmz 全栈开发/vmz-framework/packages/runtimes/vmz-test/package.json');
const puppeteer = require('puppeteer-core');
const { resolveBrowserExecutable } = require('E:/vmz 全栈开发/vmz-framework/packages/runtimes/vmz-test/dist/index.js');

const BASE = process.argv[2] ?? 'http://127.0.0.1:4280/';
const OUT = 'E:/zzz 中转站/charts-shots/interactions';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: resolveBrowserExecutable(),
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function openPage(opts = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: opts.width ?? 1440, height: opts.height ?? 900, deviceScaleFactor: 2, hasTouch: opts.touch ?? false });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('#bar-quarter [data-dvz-id^="bar:"]', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1800));
    return page;
}

async function hover(page, selector, fx = 0.5, fy = 0.5) {
    const pt = await page.evaluate((sel, fx, fy) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    }, selector, fx, fy);
    if (!pt) return null;
    await page.mouse.move(pt.x, pt.y, { steps: 6 });
    await new Promise((r) => setTimeout(r, 500));
    return pt;
}

async function shotCard(page, selector, name) {
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector);
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`shot ${name}`);
}

// 1. item tooltip on bar.
{
    const page = await openPage();
    await hover(page, '#bar-quarter [data-dvz-id="bar:0"]');
    await shotCard(page, '#bar-quarter', '01-tooltip-item-desktop');
    await page.close();
}

// 2. axis merged tooltip.
{
    const page = await openPage();
    await page.evaluate(() => document.querySelector('#ix-axis').scrollIntoView({ block: 'center' }));
    await hover(page, '#ix-axis [data-vmz-ui-charts="chart"] svg', 0.25, 0.55);
    await shotCard(page, '#ix-axis', '02-tooltip-axis-desktop');
    await page.close();
}

// 3. crosshair + nearest-point snap on line.
{
    const page = await openPage();
    await hover(page, '#line-trend [data-vmz-ui-charts="chart"] svg', 0.62, 0.5).catch(() => null);
    // fall back: any line/area card
    const has = await page.evaluate(() => !!document.querySelector('#line-trend'));
    if (!has) {
        const card = await page.evaluate(() => {
            const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('折线'));
            return c ? c.id || null : null;
        });
        if (card) await hover(page, `#${card} [data-vmz-ui-charts="chart"] svg`, 0.62, 0.5);
    }
    await page.screenshot({ path: `${OUT}/03-crosshair-line-desktop.png` });
    console.log('shot 03-crosshair-line-desktop');
    await page.close();
}

// 4. brush selection mid-drag on scatter.
{
    const page = await openPage();
    const pt = await page.evaluate(() => {
        const el = document.querySelector('#scatter-latency [data-vmz-ui-charts="chart"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    await page.mouse.move(pt.x + pt.w * 0.25, pt.y + pt.h * 0.35);
    await page.mouse.down();
    await page.mouse.move(pt.x + pt.w * 0.7, pt.y + pt.h * 0.75, { steps: 10 });
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/04-brush-drag-desktop.png` });
    console.log('shot 04-brush-drag-desktop');
    await page.mouse.up();
    await page.close();
}

// 5. legend click → hidden series dimmed + refit ticks.
{
    const page = await openPage();
    await page.evaluate(() => {
        const el = document.querySelector('#bar-stack [data-dvz-id="legend:swatch:1"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.x + 2, clientY: b.y + 2 }));
    });
    await new Promise((r) => setTimeout(r, 900));
    await shotCard(page, '#bar-stack', '05-legend-dim-refit-desktop');
    await page.close();
}

// 6. wheel zoom → ticks changed + reset button.
{
    const page = await openPage();
    const center = await page.evaluate(() => {
        const el = document.querySelector('#scatter-latency [data-vmz-ui-charts="chart"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel({ deltaY: -400 });
    await new Promise((r) => setTimeout(r, 650));
    await shotCard(page, '#scatter-latency', '06-zoom-reset-desktop');
    await page.close();
}

// 7. linked crosshair across two charts.
{
    const page = await openPage();
    await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        linkCard.scrollIntoView({ block: 'center' });
    });
    const pt = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        const svg = linkCard.querySelectorAll('[data-vmz-ui-charts="chart"]')[0];
        const b = svg.getBoundingClientRect();
        return { x: b.x + b.width * 0.6, y: b.y + b.height / 2 };
    });
    await page.mouse.move(pt.x, pt.y, { steps: 8 });
    await new Promise((r) => setTimeout(r, 650));
    await page.screenshot({ path: `${OUT}/07-link-crosshair-desktop.png` });
    console.log('shot 07-link-crosshair-desktop');
    await page.close();
}

// 8. mobile: tap shows tooltip.
{
    const page = await openPage({ width: 390, height: 844, touch: true });
    const pt = await page.evaluate(() => {
        const el = document.querySelector('#bar-quarter [data-dvz-id="bar:1"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.tap(pt.x, pt.y);
    await new Promise((r) => setTimeout(r, 500));
    await shotCard(page, '#bar-quarter', '08-touch-tap-mobile');
    await page.close();
}

// 9. mobile: long-press pins tooltip.
{
    const page = await openPage({ width: 390, height: 844, touch: true });
    const pt = await page.evaluate(() => {
        const el = document.querySelector('#bar-quarter [data-dvz-id="bar:2"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.touchStart(pt.x, pt.y);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/09-touch-longpress-pin-mobile.png` });
    console.log('shot 09-touch-longpress-pin-mobile');
    await page.touchscreen.touchEnd();
    await page.close();
}

// 10. mobile: linked crosshair via touch hover (single finger move).
{
    const page = await openPage({ width: 390, height: 844, touch: true });
    await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        linkCard.scrollIntoView({ block: 'center' });
    });
    const pt = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        const svg = linkCard.querySelectorAll('[data-vmz-ui-charts="chart"]')[0];
        const b = svg.getBoundingClientRect();
        return { x: b.x + b.width * 0.55, y: b.y + b.height / 2 };
    });
    await page.touchscreen.touchStart(pt.x, pt.y);
    await page.touchscreen.touchMove(pt.x + 30, pt.y);
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${OUT}/10-touch-link-mobile.png` });
    console.log('shot 10-touch-link-mobile');
    await page.touchscreen.touchEnd();
    await page.close();
}

await browser.close();
console.log(`done → ${OUT}`);

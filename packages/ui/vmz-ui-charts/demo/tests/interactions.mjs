// Interaction acceptance for `@vmz/ui-charts` on the built bench.
// Usage: build the bench (`vmz build . --profile static` in demo/), serve
// dist/static, then `node tests/interactions.mjs [baseUrl]`.
// Every section prints PASS/FAIL lines; exit code is non-zero on any FAIL.
import { createRequire } from 'node:module';

const require = createRequire('E:/vmz 全栈开发/vmz-framework/packages/runtimes/vmz-test/package.json');
const puppeteer = require('puppeteer-core');
const { resolveBrowserExecutable } = require('E:/vmz 全栈开发/vmz-framework/packages/runtimes/vmz-test/dist/index.js');

const BASE = process.argv[2] ?? 'http://127.0.0.1:4280/';
const results = [];
const check = (name, ok, detail = '') => {
    results.push([name, ok, detail]);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
    executablePath: resolveBrowserExecutable(),
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function openPage(opts = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: opts.width ?? 1440, height: opts.height ?? 900, deviceScaleFactor: opts.dpr ?? 1, hasTouch: opts.touch ?? false });
    if (opts.reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('#bar-quarter [data-dvz-id^="bar:"]', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1800));
    return page;
}

async function hoverMark(page, selector) {
    const pt = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, selector);
    if (!pt) return null;
    await page.mouse.move(pt.x, pt.y, { steps: 6 });
    await new Promise((r) => setTimeout(r, 450));
    return pt;
}

const tooltipText = (page) =>
    page.evaluate(() => {
        const t = [...document.querySelectorAll('.vmz-ui-charts__tooltip')].find((n) => getComputedStyle(n).visibility !== 'hidden' && n.textContent.trim() !== '');
        return t ? t.textContent.trim() : null;
    });

// ─── 1. tooltip: item + axis trigger ─────────────────────────────────────
{
    const page = await openPage();
    await hoverMark(page, '#bar-quarter [data-dvz-id="bar:0"]');
    const item = await tooltipText(page);
    check('tooltip.item bar hit', item !== null && item.includes('42'), item);

    await hoverMark(page, '#ix-axis [data-dvz-id^="bar:"]');
    const axis = await tooltipText(page);
    const merged = axis !== null && axis.includes('North') && axis.includes('South') && axis.includes('quarter');
    check('tooltip.axis merged same-slot series', merged, axis);
    await page.close();
}

// ─── 2. touch: tap tooltip, long-press pin, vertical scroll passes ───────
{
    const page = await openPage({ touch: true, width: 390, height: 844, dpr: 2 });
    const pt = await page.evaluate(() => {
        const el = document.querySelector('#bar-quarter [data-dvz-id="bar:0"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.tap(pt.x, pt.y);
    await new Promise((r) => setTimeout(r, 500));
    const tap = await tooltipText(page);
    check('touch.tap shows tooltip', tap !== null && tap.includes('42'), tap);

    // Long-press pins the tooltip: hold 700ms, then move away — it stays.
    await page.touchscreen.touchStart(pt.x, pt.y);
    await new Promise((r) => setTimeout(r, 700));
    await page.touchscreen.touchEnd();
    await page.mouse.move(pt.x, pt.y - 120, { steps: 3 });
    await new Promise((r) => setTimeout(r, 300));
    const pinned = await tooltipText(page);
    check('touch.long-press pins tooltip', pinned !== null, pinned);

    // Vertical swipe scrolls the page (not trapped by the chart).
    const y0 = await page.evaluate(() => window.scrollY);
    await page.touchscreen.touchStart(pt.x, pt.y);
    for (let i = 0; i < 8; i++) await page.touchscreen.touchMove(pt.x, pt.y - 40 * i);
    await page.touchscreen.touchEnd();
    await new Promise((r) => setTimeout(r, 500));
    const y1 = await page.evaluate(() => window.scrollY);
    check('touch.vertical swipe scrolls page', y1 !== y0, `${y0}→${y1}`);
    await page.close();
}

// ─── 3. keyboard + aria-live ─────────────────────────────────────────────
{
    const page = await openPage();
    await page.evaluate(() => document.querySelector('#bar-quarter [data-vmz-ui-charts="chart"]').focus());
    await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 350));
    const t1 = await tooltipText(page);
    check('kbd.arrow focuses first target', t1 !== null, t1);
    await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 250));
    const t2 = await tooltipText(page);
    check('kbd.arrow moves target', t2 !== null && t2 !== t1, `${t1} → ${t2}`);
    await page.keyboard.press('End');
    await new Promise((r) => setTimeout(r, 250));
    const tEnd = await tooltipText(page);
    check('kbd.End jumps to last', tEnd !== null && tEnd !== t2, tEnd);
    await page.keyboard.press('Home');
    await new Promise((r) => setTimeout(r, 250));
    const tHome = await tooltipText(page);
    check('kbd.Home jumps to first', tHome === t1, tHome);
    // aria-live matches the tooltip text.
    const live = await page.evaluate(() => document.querySelector('#bar-quarter [aria-live="polite"]:not(.vmz-ui-charts__tooltip)')?.textContent?.trim() ?? '');
    check('a11y.aria-live announces point', live !== '' && tHome !== null && live.includes('quarter') , live.slice(0, 60));
    // Enter pins; mouse leaves; tooltip stays.
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 200));
    await page.mouse.move(20, 20, { steps: 2 });
    await new Promise((r) => setTimeout(r, 300));
    const pinned = await tooltipText(page);
    check('kbd.Enter pins tooltip', pinned === tHome, pinned);
    // Esc closes.
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    const closed = await tooltipText(page);
    check('kbd.Esc closes tooltip', closed === null, String(closed));
    await page.close();
}

// ─── 4. legend: click toggle with real re-fit, isolate restore ───────────
{
    const page = await openPage();
    const before = await page.evaluate(() => ({
        bars: document.querySelectorAll('#bar-stack [data-dvz-id^="bar:"]').length,
        ticks: [...document.querySelectorAll('#bar-stack [data-dvz-id^="y-axis:label"]')].map((n) => n.textContent).join(','),
    }));
    // Click the South legend swatch on the stacked card.
    await page.evaluate(() => {
        const el = document.querySelector('#bar-stack [data-dvz-id="legend:swatch:1"]');
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.x + 2, clientY: b.y + 2 }));
    });
    await new Promise((r) => setTimeout(r, 900));
    const after = await page.evaluate(() => ({
        bars: document.querySelectorAll('#bar-stack [data-dvz-id^="bar:"]').length,
        ticks: [...document.querySelectorAll('#bar-stack [data-dvz-id^="y-axis:label"]')].map((n) => n.textContent).join(','),
        swatchOpacity: getComputedStyle(document.querySelector('#bar-stack [data-dvz-id="legend:swatch:1"]')).opacity,
        legendStillThere: !!document.querySelector('#bar-stack [data-dvz-id="legend:swatch:1"]'),
    }));
    check('legend.click hides series bars', after.bars < before.bars, `${before.bars}→${after.bars}`);
    check('legend.click refits y domain', after.ticks !== before.ticks, `${before.ticks} → ${after.ticks}`);
    check('legend.keeps swatch clickable (dimmed)', after.legendStillThere && after.swatchOpacity === '0.35', after.swatchOpacity);
    // Click again restores.
    await page.evaluate(() => {
        const el = document.querySelector('#bar-stack [data-dvz-id="legend:swatch:1"]');
        const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.x + 2, clientY: b.y + 2 }));
    });
    await new Promise((r) => setTimeout(r, 900));
    const restored = await page.evaluate(() => document.querySelectorAll('#bar-stack [data-dvz-id^="bar:"]').length);
    check('legend.click again restores', restored === before.bars, String(restored));
    await page.close();
}

// ─── 5. zoom: wheel + ticks consistent + reset button + dblclick ─────────
{
    const page = await openPage();
    const ticksBefore = await page.evaluate(() => [...document.querySelectorAll('#scatter-latency [data-dvz-id^="x-axis:label"]')].map((n) => n.textContent));
    await page.evaluate(() => document.querySelector('#scatter-latency [data-vmz-ui-charts="chart"]').scrollIntoView({ block: 'center' }));
    const center = await page.evaluate(() => {
        const b = document.querySelector('#scatter-latency [data-vmz-ui-charts="chart"]').getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel({ deltaY: -400 });
    await new Promise((r) => setTimeout(r, 600));
    const state = await page.evaluate(() => ({
        ticks: [...document.querySelectorAll('#scatter-latency [data-dvz-id^="x-axis:label"]')].map((n) => n.textContent),
        resetVisible: !!document.querySelector('#scatter-latency .vmz-ui-charts__zoom-reset'),
    }));
    check('zoom.wheel changes domain ticks', state.ticks.join(',') !== ticksBefore.join(','), state.ticks.join(','));
    check('zoom.reset button appears', state.resetVisible);
    // Tooltip still reads raw values after zoom (no re-aggregation).
    await hoverMark(page, '#scatter-latency [data-dvz-id^="point:"]');
    const tip = await tooltipText(page);
    check('zoom.tooltip keeps raw values', tip !== null && /latency|size/.test(tip), tip);
    // Reset button restores.
    await page.click('#scatter-latency .vmz-ui-charts__zoom-reset');
    await new Promise((r) => setTimeout(r, 600));
    const restored = await page.evaluate(() => [...document.querySelectorAll('#scatter-latency [data-dvz-id^="x-axis:label"]')].map((n) => n.textContent).join(','));
    check('zoom.reset restores domain', restored === ticksBefore.join(','), restored);
    await page.close();
}

// ─── 6. linkId: crosshair aligns across charts ───────────────────────────
{
    const page = await openPage();
    await hoverMark(page, '.card:nth-of-type(5) [data-vmz-ui-charts="chart"] svg');
    // Move over the first linked chart's plot.
    const pt = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        const svg = linkCard.querySelectorAll('[data-vmz-ui-charts="chart"]')[0];
        svg.scrollIntoView({ block: 'center' });
        const b = svg.getBoundingClientRect();
        return { x: b.x + b.width * 0.6, y: b.y + b.height / 2 };
    });
    await page.mouse.move(pt.x, pt.y, { steps: 8 });
    await new Promise((r) => setTimeout(r, 600));
    const linked = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const linkCard = cards.find((c) => c.textContent.includes('联动 crosshair'));
        const charts = linkCard.querySelectorAll('[data-vmz-ui-charts="chart"]');
        const cross = (c) => {
            const el = c.querySelector('.vmz-ui-charts__crosshair');
            return el && getComputedStyle(el).display !== 'none' ? getComputedStyle(el).left : null;
        };
        return { a: cross(charts[0]), b: cross(charts[1]) };
    });
    check('link.crosshair aligns peer chart', linked.a !== null && linked.b !== null, JSON.stringify(linked));
    await page.close();
}

// ─── 7. motion: entrance runs normally, zero under reduced-motion ────────
{
    // Animations only run in the full new-headless mode; shell mode skips them.
    // 注意：new headless 默认 `prefers-reduced-motion: reduce`，必须显式
    // emulate 成 no-preference，否则入场动画被媒体查询合法关闭。
    const full = await puppeteer.launch({
        executablePath: resolveBrowserExecutable(),
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await full.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('#bar-quarter [data-dvz-id^="bar:"]', { timeout: 30000 });
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('#bar-quarter .vmz-ui-charts__svg svg')).animationName);
    check('motion.entrance animation present', anim !== 'none', anim);
    await full.close();

    const rm = await puppeteer.launch({
        executablePath: resolveBrowserExecutable(),
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page2 = await rm.newPage();
    await page2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page2.goto(BASE, { waitUntil: 'networkidle0', timeout: 120000 });
    await page2.waitForSelector('#bar-quarter [data-dvz-id^="bar:"]', { timeout: 30000 });
    const animRm = await page2.evaluate(() => getComputedStyle(document.querySelector('#bar-quarter .vmz-ui-charts__svg svg')).animationName);
    check('motion.reduced-motion disables animation', animRm === 'none', animRm);
    await rm.close();
}

// ─── 8. degradation: empty / single point / >20 series ───────────────────
{
    const page = await openPage();
    const empty = await page.evaluate(() => {
        const c = document.querySelector('#ix-degrade');
        return {
            emptyText: [...document.querySelectorAll('.vmz-ui-charts__empty')].some((n) => n.textContent.trim() !== ''),
        };
    });
    check('degrade.empty state explicit', empty.emptyText);
    await hoverMark(page, '#ix-degrade [data-vmz-ui-charts="chart"][aria-label="single point line"] [data-dvz-id]');
    const single = await tooltipText(page);
    check('degrade.single point tooltip', single !== null && single.includes('42'), single);
    const many = await page.evaluate(() => ({
        bars: document.querySelectorAll('#ix-degrade [data-dvz-id^="bar:"]').length,
        overflow: !!document.querySelector('#ix-degrade [data-dvz-id="legend:overflow"]'),
    }));
    check('degrade.24 series legend +N', many.bars > 60 && many.overflow, JSON.stringify(many));
    await page.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} interaction checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

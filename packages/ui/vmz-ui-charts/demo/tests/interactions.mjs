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

/** 图表宿主内离任何命中元素最远的点（点空白用）。 */
async function blankPointIn(page, hostSelector, hitSelector) {
    return page.evaluate(
        (hostSel, hitSel) => {
            const host = document.querySelector(hostSel);
            const hits = [...document.querySelectorAll(`${hostSel} ${hitSel}`)];
            if (!host || hits.length === 0) return null;
            const hb = host.getBoundingClientRect();
            const boxes = hits.map((el) => el.getBoundingClientRect());
            const dist = (px, py, b) => Math.hypot(Math.max(b.left - px, 0, px - b.right), Math.max(b.top - py, 0, py - b.bottom));
            let best = null;
            let bestD = -1;
            for (let x = hb.left + 1; x < hb.right; x += 3) {
                for (let y = hb.top + 1; y < hb.bottom; y += 3) {
                    let m = Infinity;
                    for (const b of boxes) m = Math.min(m, dist(x, y, b));
                    if (m > bestD) {
                        bestD = m;
                        best = { x, y };
                    }
                }
            }
            return best;
        },
        hostSelector,
        hitSelector,
    );
}

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
    check('a11y.aria-live announces point', live !== '' && tHome !== null && live.includes('quarter'), live.slice(0, 60));
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

// ─── 9. tooltip viewport clamp on 390px (right-edge points must not overflow) ─
{
    const page = await openPage({ width: 390, height: 844, touch: true });
    // Hover the rightmost bar of the first chart; tooltip must stay inside host.
    const pt = await page.evaluate(() => {
        const bars = [...document.querySelectorAll('#bar-quarter [data-dvz-id^="bar:"]')];
        const last = bars[bars.length - 1];
        last.scrollIntoView({ block: 'center' });
        const b = last.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.tap(pt.x, pt.y);
    await new Promise((r) => setTimeout(r, 500));
    const clamp = await page.evaluate(() => {
        const host = document.querySelector('#bar-quarter [data-vmz-ui-charts="chart"]');
        const tip = host.querySelector('.vmz-ui-charts__tooltip');
        if (!tip) return { visible: false };
        const h = host.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        return {
            visible: true,
            left: t.left - h.left,
            right: h.right - t.right,
            top: t.top - h.top,
            bottom: h.bottom - t.bottom,
        };
    });
    check(
        'tooltip.clamp stays inside host on 390px',
        clamp.visible && clamp.left >= -1 && clamp.top >= -1 && clamp.right >= -1 && clamp.bottom >= -1,
        JSON.stringify(clamp),
    );
    await page.close();
}

// ─── 10. six ruled types: hover tooltip + keyboard + hidden data table ───
{
    const page = await openPage();
    const typeCards = ['force-deps', 'parallel-cars', 'hexbin-density', 'contour-density', 'chord-regions', 'geo-world'];
    for (const cardId of typeCards) {
        // Hover the first nav target at its true geometry anchor (sector
        // mid-angle, polygon centroid, rect center — the component's own
        // anchor contract), converted to client coordinates.
        const pt = await page.evaluate((cid) => {
            const card = document.getElementById(cid);
            if (!card) return { err: 'no card' };
            const host = card.querySelector('[data-vmz-ui-charts="chart"]');
            // Collect every chart instance on the page, then match by dom root —
            // layout instance lists are page-global, never trust first-hit order.
            const all = new Set();
            for (const h of document.querySelectorAll('[data-vmz-ui-charts="chart"]')) {
                let cur = h;
                while (cur && cur !== document.body) {
                    if (cur.__vmzInst) all.add(cur.__vmzInst);
                    if (Array.isArray(cur.__vmzLayoutInsts)) for (const m of cur.__vmzLayoutInsts) all.add(m);
                    cur = cur.parentElement;
                }
            }
            const inst = [...all].find((m) => m && m.__vmzDomRoot === host && typeof m._navTargets === 'function');
            if (!inst) return { err: 'no instance' };
            const targets = inst._navTargets();
            if (!targets || targets.length === 0) return { err: 'no nav targets' };
            const t0 = targets[0];
            const anchor = t0.point ?? inst._nodeAnchor(t0.id);
            if (!anchor) return { err: 'no anchor' };
            host.scrollIntoView({ block: 'center' });
            const rect = host.getBoundingClientRect();
            const sx = rect.width / inst._effWidth();
            const sy = rect.height / inst._effHeight();
            return { x: rect.left + anchor.x * sx, y: rect.top + anchor.y * sy };
        }, cardId);
        if (pt.err) {
            check(`six.${cardId} hover tooltip`, false, pt.err);
        } else {
            await page.mouse.move(pt.x, pt.y, { steps: 4 });
            await new Promise((r) => setTimeout(r, 400));
            // Tooltip must belong to THIS card — a stale one from another chart
            // would be a false positive.
            const tip = await page.evaluate((cid2) => {
                const t = document.getElementById(cid2).querySelector('.vmz-ui-charts__tooltip');
                return t && t.textContent.trim() !== '' ? t.textContent.trim() : null;
            }, cardId);
            check(`six.${cardId} hover tooltip`, tip !== null, tip ?? 'null');
        }
        await page.mouse.move(8, 8, { steps: 2 });
        await new Promise((r) => setTimeout(r, 250));

        // Keyboard: focus host, ArrowRight focuses a target, aria-live speaks.
        const kbd = await page.evaluate((cid) => {
            const card = document.getElementById(cid);
            const host = card.querySelector('[data-vmz-ui-charts="chart"]');
            host.focus();
            return null;
        }, cardId);
        void kbd;
        await page.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 300));
        const live = await page.evaluate((cid) => {
            const card = document.getElementById(cid);
            const liveEl = [...card.querySelectorAll('[aria-live="polite"]')].find((n) => n.classList.contains('vmz-ui-charts__sr'));
            return liveEl ? liveEl.textContent.trim() : '';
        }, cardId);
        check(`six.${cardId} keyboard aria-live`, live !== '', live.slice(0, 60));

        // Hidden data table stays in sync (rows rendered for screen readers).
        const rows = await page.evaluate((cid) => {
            const card = document.getElementById(cid);
            const table = card.querySelector('.vmz-ui-charts__sr table');
            return table ? table.querySelectorAll('tr').length : 0;
        }, cardId);
        check(`six.${cardId} hidden data table`, rows > 1, `rows=${rows}`);
    }
    // geo value path: a region with a matched data row reports field and value.
    const gpt = await page.evaluate(() => {
        const card = document.getElementById('geo-world');
        const host = card.querySelector('[data-vmz-ui-charts="chart"]');
        const all = new Set();
        for (const h of document.querySelectorAll('[data-vmz-ui-charts="chart"]')) {
            let cur = h;
            while (cur && cur !== document.body) {
                if (cur.__vmzInst) all.add(cur.__vmzInst);
                if (Array.isArray(cur.__vmzLayoutInsts)) for (const m of cur.__vmzLayoutInsts) all.add(m);
                cur = cur.parentElement;
            }
        }
        const inst = [...all].find((m) => m && m.__vmzDomRoot === host);
        if (!inst || !inst._plan) return null;
        // Matched regions are keyed by row key, unmatched by feature name —
        // resolve China's scene id through the compiled channel, never guess.
        const mark = inst._plan.marks.find((m) => m.channels.get('feature') === 'China' || m.key === 'China');
        if (!mark) return null;
        const anchor = inst._nodeAnchor(`geo:${mark.key}`);
        if (!anchor) return null;
        host.scrollIntoView({ block: 'center' });
        const rect = host.getBoundingClientRect();
        return { x: rect.left + (anchor.x * rect.width) / inst._effWidth(), y: rect.top + (anchor.y * rect.height) / inst._effHeight() };
    });
    if (gpt) {
        await page.mouse.move(gpt.x, gpt.y, { steps: 4 });
        await new Promise((r) => setTimeout(r, 400));
        const gtip = await page.evaluate(() => {
            const t = document.getElementById('geo-world').querySelector('.vmz-ui-charts__tooltip');
            return t ? t.textContent.trim() : null;
        });
        check('six.geo-world tooltip carries matched value', gtip !== null && gtip.includes('China') && gtip.includes('17795'), gtip ?? 'null');
    } else {
        check('six.geo-world tooltip carries matched value', false, 'no anchor for geo:China');
    }
    await page.close();
}

// ─── 11. treemap selection: click emits to the host, blank click clears ──
{
    const page = await openPage();
    await page.evaluate(() => {
        window.__selEvents = [];
        document.addEventListener('vmz-chart-selection-change', (e) => window.__selEvents.push(e.detail));
    });
    const leaf = await page.evaluate(() => {
        const el = document.querySelector('#treemap-disk [data-dvz-id="treemap:视频"]');
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    check('select.leaf rect present', leaf !== null);
    if (leaf) {
        await page.mouse.click(leaf.x, leaf.y);
        await new Promise((r) => setTimeout(r, 450));
        const afterClick = await page.evaluate(() => ({
            events: window.__selEvents.map((d) => (d && Array.isArray(d.selection) ? d.selection : null)),
            dimmed: [...document.querySelectorAll('#treemap-disk rect[data-dvz-id^="treemap:"]')].filter((r) => r.style.opacity === '0.35').length,
        }));
        check(
            'select.click emits selection-change with the clicked mark id',
            afterClick.events.length === 1 && JSON.stringify(afterClick.events[0]) === JSON.stringify(['treemap:视频']),
            JSON.stringify(afterClick.events),
        );
        check('select.click paints other marks dimmed', afterClick.dimmed > 0, `dimmed=${afterClick.dimmed}`);

        // Blank point: the in-host point farthest from any treemap rect.
        const blank = await blankPointIn(page, '#treemap-disk [data-vmz-ui-charts="chart"]', 'rect[data-dvz-id^="treemap:"]');
        await page.mouse.click(blank.x, blank.y);
        await new Promise((r) => setTimeout(r, 450));
        const afterBlank = await page.evaluate(() => ({
            events: window.__selEvents.map((d) => (d && Array.isArray(d.selection) ? d.selection : null)),
            dimmed: [...document.querySelectorAll('#treemap-disk rect[data-dvz-id^="treemap:"]')].filter((r) => r.style.opacity === '0.35').length,
        }));
        check(
            'select.blank click clears selection and emits an empty set',
            afterBlank.events.length === 2 && JSON.stringify(afterBlank.events[1]) === JSON.stringify([]),
            JSON.stringify(afterBlank.events),
        );
        check('select.blank click restores full opacity', afterBlank.dimmed === 0, `dimmed=${afterBlank.dimmed}`);
    }
    await page.close();
}

// ─── 12. controlled selection: interactions only propose ─────────────────
{
    const page = await openPage();
    await page.evaluate(() => {
        window.__ctrlSel = [];
        document.addEventListener('vmz-chart-selection-change', (e) => window.__ctrlSel.push(e.detail));
    });
    const clickMark = async (markId) => {
        const pt = await page.evaluate((id) => {
            const el = document.querySelector(`#controlled-bar [data-dvz-id="${id}"]`);
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const b = el.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, markId);
        if (!pt) return null;
        await page.mouse.click(pt.x, pt.y);
        await new Promise((r) => setTimeout(r, 400));
        return pt;
    };
    const events = () => page.evaluate(() => window.__ctrlSel.map((d) => (d && Array.isArray(d.selection) ? d.selection : null)));
    const markOpacity = (markId) =>
        page.evaluate((id) => {
            const el = document.querySelector(`#controlled-bar [data-dvz-id="${id}"]`);
            return el ? el.style.opacity : null;
        }, markId);

    check('controlled.click leaf rect present', (await clickMark('bar:1')) !== null);
    const e1 = await events();
    check(
        'controlled.click proposes the toggled set',
        e1.length === 1 && JSON.stringify(e1[0]) === JSON.stringify(['bar:0', 'bar:1']),
        JSON.stringify(e1),
    );
    // 宿主没回灌:提议不得落到组件自己的选中态。指针先移出图表,排除 hover 的
    // 高亮影响,bar:1 仍应按未选中变暗。
    await page.mouse.move(2, 2, { steps: 2 });
    await new Promise((r) => setTimeout(r, 350));
    check('controlled.click does not self-apply', (await markOpacity('bar:1')) === '0.35', await markOpacity('bar:1'));

    const blank = await blankPointIn(page, '#controlled-bar [data-vmz-ui-charts="chart"]', 'rect[data-dvz-id^="bar:"]');
    await page.mouse.click(blank.x, blank.y);
    await new Promise((r) => setTimeout(r, 400));
    const e2 = await events();
    check('controlled.blank click proposes an empty set', e2.length === 2 && JSON.stringify(e2[1]) === JSON.stringify([]), JSON.stringify(e2));

    await page.evaluate(() => document.querySelector('#controlled-bar [data-vmz-ui-charts="chart"]').focus());
    await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 300));
    await page.keyboard.press('Space');
    await new Promise((r) => setTimeout(r, 350));
    const e3 = await events();
    check('controlled.Space proposes the toggled set', e3.length === 3 && JSON.stringify(e3[2]) === JSON.stringify([]), JSON.stringify(e3));

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 350));
    const e4 = await events();
    check('controlled.Escape proposes an empty set', e4.length === 4 && JSON.stringify(e4[3]) === JSON.stringify([]), JSON.stringify(e4));
    await page.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} interaction checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

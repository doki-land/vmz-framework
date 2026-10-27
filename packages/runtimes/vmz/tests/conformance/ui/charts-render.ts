/**
 * charts-render gate — @vmz/ui-charts real chart pipeline.
 *
 * Asserts:
 * - `compile` → `buildScene` maps plan scale ranges into the pixel viewport
 *   for bar / line / point marks (compile never guesses pixels)
 * - stable ids live on SemanticScene (rowIndex / series); DisplayScene strips
 *   domain semantics as designed, so markup carries geometry only
 * - axes carry baselines, short tick marks and data-derived labels (numeric
 *   4–6 ticks, band one per category) with minimal decimals
 * - a legend appears only when a color / series channel exists, and sits in the
 *   plot's upper right, clear of the ticks
 * - text bounds are a deterministic size estimate centred on the anchor
 * - `renderSvg` is deterministic, viewBox comes from the scene size, numbers
 *   stay at ≤3 decimals, text/attributes are escaped and empty data is safe
 */

import { buildScene, compile, fromRows } from '../../../../../davinci/davinci-chart/src/index.ts';
import { resolve } from '../../../../../davinci/davinci-scene/src/index.ts';
import { renderSvg } from '../../../../../ui/vmz-ui-charts/src/render/svg.ts';

const WIDTH = 640;
const HEIGHT = 360;

function fail(msg) {
    console.error(`charts-render GATE FAIL: ${msg}`);
    process.exit(1);
}

function count(haystack, needle) {
    let n = 0;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
        n += 1;
        at = haystack.indexOf(needle, at + needle.length);
    }
    return n;
}

function pipeline(spec, rows) {
    const plan = compile(spec, fromRows(rows));
    const semantic = buildScene(plan, { width: WIDTH, height: HEIGHT });
    const display = resolve(semantic, { width: WIDTH, height: HEIGHT });
    return { plan, semantic, display, svg: renderSvg(display) };
}

function guideGroups(semantic, role) {
    return semantic.root.children.filter((n) => n.kind === 'group' && n.role === role);
}

function axisStats(semantic) {
    const groups = guideGroups(semantic, 'chart.axis');
    const paths = groups.reduce((sum, g) => sum + g.children.filter((c) => c.kind === 'path').length, 0);
    const texts = groups.reduce((sum, g) => sum + g.children.filter((c) => c.kind === 'text').length, 0);
    return { groups, paths, texts };
}

function collectTexts(node, out = []) {
    if (node.kind === 'text') out.push(node);
    else if (node.kind === 'group') for (const child of node.children) collectTexts(child, out);
    return out;
}

const barSpec = {
    mark: 'bar',
    encoding: [
        { field: 'category', channel: 'x' },
        { field: 'value', channel: 'y' },
    ],
};
const barRows = [
    { category: 'alpha', value: 3 },
    { category: 'beta', value: 7 },
    { category: 'gamma', value: 5 },
];

console.log('charts-render: bar → rect marks…');
{
    const { semantic, display, svg } = pipeline(barSpec, barRows);
    const marks = semantic.root.children.filter((n) => n.kind === 'rect');
    if (marks.length !== barRows.length) fail(`want ${barRows.length} rect nodes, got ${marks.length}`);
    for (let i = 0; i < barRows.length; i++) {
        if (marks[i].id !== `bar:${i}`) fail(`stable id want bar:${i}, got ${marks[i].id}`);
        if (marks[i].role !== 'chart.mark') fail(`bar:${i} role want chart.mark, got ${marks[i].role}`);
    }
    if (!(marks[0].x < marks[1].x && marks[1].x < marks[2].x)) {
        fail('band categories must be evenly distributed on x');
    }
    if (!(marks[1].y < marks[2].y && marks[2].y < marks[0].y)) {
        // zero-based domain [0, 7]: 7 is tallest (smallest y), then 5, then 3
        fail('quantitative y must grow downward: y(7) < y(5) < y(3)');
    }
    if (marks.some((m) => !(m.h > 0))) fail('bar-like marks must be measured from a zero baseline');
    if (display.width !== WIDTH || display.height !== HEIGHT) {
        fail(`display size want ${WIDTH}x${HEIGHT}, got ${display.width}x${display.height}`);
    }
    if (count(svg, '<rect') !== barRows.length) fail(`svg want ${barRows.length} <rect>, got ${count(svg, '<rect')}`);
    if (!svg.includes(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`)) fail(`viewBox must come from scene size: ${svg.slice(0, 200)}`);

    const { groups, paths, texts } = axisStats(semantic);
    if (groups.length !== 2) fail(`want 2 axis groups (x + y), got ${groups.length}`);
    if (!groups.some((g) => g.id === 'x-axis') || !groups.some((g) => g.id === 'y-axis')) {
        fail('x-axis / y-axis groups missing');
    }
    if (count(svg, '<path') !== paths) fail(`svg want ${paths} axis <path>, got ${count(svg, '<path')}`);
    if (count(svg, '<text') !== texts) fail(`svg want ${texts} axis <text>, got ${count(svg, '<text')}`);
    if (!svg.includes('text-anchor="middle"')) fail('text must declare text-anchor');
    if (!svg.includes('dominant-baseline="middle"')) fail('text must declare dominant-baseline');
    if (svg.includes('NaN')) fail('svg must not carry NaN attributes');
    if (guideGroups(semantic, 'chart.legend').length !== 0) fail('no legend without a color / series channel');
}

console.log('charts-render: axes and ticks come from data…');
{
    const { semantic, svg } = pipeline(barSpec, barRows);
    const xAxis = guideGroups(semantic, 'chart.axis').find((g) => g.id === 'x-axis');
    const yAxis = guideGroups(semantic, 'chart.axis').find((g) => g.id === 'y-axis');

    const xLabels = xAxis.children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (xLabels.join(',') !== 'alpha,beta,gamma') fail(`band axis must label every category: ${xLabels}`);
    const yLabels = yAxis.children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (yLabels.length < 4 || yLabels.length > 6) fail(`numeric axis wants 4–6 ticks, got ${yLabels.length}`);
    if (yLabels.some((l) => !Number.isFinite(Number(l)))) fail(`numeric tick labels must parse: ${yLabels}`);

    if (!xAxis.children.some((n) => n.kind === 'path' && n.id === 'x-axis:baseline')) fail('x baseline missing');
    if (!yAxis.children.some((n) => n.kind === 'path' && n.id === 'y-axis:baseline')) fail('y baseline missing');

    const xTicks = xAxis.children.filter((n) => n.kind === 'path' && n.id !== 'x-axis:baseline');
    if (xTicks.length !== barRows.length) fail(`want ${barRows.length} x tick marks, got ${xTicks.length}`);
    const xTick = xTicks[0].path.commands;
    if (xTick.length !== 2 || xTick[0].kind !== 'move' || xTick[1].kind !== 'line') {
        fail('tick marks must be move → line paths');
    }
    if (xTick[0].to.x !== xTick[1].to.x || !(xTick[1].to.y > xTick[0].to.y)) {
        fail('x tick marks must be short vertical lines below the baseline');
    }
    const yTick = yAxis.children.filter((n) => n.kind === 'path' && n.id !== 'y-axis:baseline')[0].path.commands;
    if (yTick[0].to.y !== yTick[1].to.y || !(yTick[1].to.x > yTick[0].to.x)) {
        fail('y tick marks must be short horizontal lines left of the baseline');
    }

    // Labels sit below / left of their tick, never on top of the plot marks.
    for (const node of xAxis.children.filter((n) => n.kind === 'text')) {
        if (node.anchor.y <= HEIGHT - 16) fail(`x label must sit under the baseline: ${node.text}`);
    }
}

console.log('charts-render: line → sorted single path…');
{
    const lineSpec = {
        mark: 'line',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    // Deliberately unordered rows: the path must follow x, not row order.
    const lineRows = [
        { step: 3, score: 1 },
        { step: 1, score: 2 },
        { step: 2, score: 3 },
    ];
    const { semantic, svg } = pipeline(lineSpec, lineRows);
    const paths = semantic.root.children.filter((n) => n.kind === 'path');
    if (paths.length !== 1) fail(`want exactly one line path, got ${paths.length}`);
    if (paths[0].id !== 'line:series') fail(`line id want line:series, got ${paths[0].id}`);
    const commands = paths[0].path.commands;
    if (commands.length !== lineRows.length) fail(`line commands want ${lineRows.length}, got ${commands.length}`);
    if (commands[0].kind !== 'move') fail('line path must start with move');
    const xs = commands.map((c) => c.to.x);
    for (let i = 1; i < xs.length; i++) {
        if (xs[i] < xs[i - 1]) fail(`line path must be sorted by x: ${JSON.stringify(xs)}`);
    }
    const { paths: axisPaths } = axisStats(semantic);
    if (count(svg, '<path') !== 1 + axisPaths) {
        fail(`svg want 1 mark + ${axisPaths} axis <path>, got ${count(svg, '<path')}`);
    }
    if (!svg.includes('d="M ')) fail('path markup missing d attribute');
}

console.log('charts-render: point / circle → ellipse marks…');
{
    const pointSpec = {
        mark: 'circle',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const { semantic, svg } = pipeline(pointSpec, [
        { step: 1, score: 2 },
        { step: 2, score: 4 },
        { step: 3, score: 3 },
    ]);
    const marks = semantic.root.children.filter((n) => n.kind === 'ellipse');
    if (marks.length !== 3) fail(`want 3 ellipse nodes, got ${marks.length}`);
    if (marks[0].id !== 'circle:0' || marks[2].id !== 'circle:2') fail('circle ids must come from rowIndex');
    if (count(svg, '<ellipse') !== 3) fail(`svg want 3 <ellipse>, got ${count(svg, '<ellipse')}`);
    if (count(svg, '<text') === 0) fail('point chart must still emit axis labels');
}

console.log('charts-render: tick labels keep minimal decimals…');
{
    const fracSpec = {
        mark: 'line',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const { semantic, svg } = pipeline(fracSpec, [
        { step: 0.1, score: 0.1 },
        { step: 0.2, score: 0.3 },
        { step: 0.4, score: 0.2 },
    ]);
    const labels = guideGroups(semantic, 'chart.axis')
        .flatMap((g) => g.children)
        .filter((n) => n.kind === 'text')
        .map((n) => n.text);
    for (const label of labels) {
        if (!/^-?\d+(\.\d{1,2})?$/.test(label)) fail(`unexpected tick label: ${label}`);
        if (/\.\d*0$/.test(label)) fail(`tick labels must drop trailing zeros: ${label}`);
    }
    if (/\d+\.\d{4,}/.test(svg)) fail(`numbers must stay at ≤3 decimals: ${svg.match(/\d+\.\d{4,}/)[0]}`);
    if (svg.includes('0.30000000000000004')) fail('floating point tails must be normalized');
    if (svg.includes('NaN')) fail('fractional ticks must not produce NaN');
}

console.log('charts-render: legend appears only for color / series…');
{
    const colorSpec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
            { field: 'region', channel: 'color' },
        ],
    };
    const colorRows = [
        { category: 'alpha', value: 3, region: 'A' },
        { category: 'beta', value: 7, region: 'B' },
        { category: 'gamma', value: 5, region: 'A' },
    ];
    const { semantic, svg } = pipeline(colorSpec, colorRows);
    const legends = guideGroups(semantic, 'chart.legend');
    if (legends.length !== 1) fail(`want exactly one legend group, got ${legends.length}`);

    const children = legends[0].children;
    const swatches = children.filter((n) => n.kind === 'rect');
    const labels = children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (labels.join(',') !== 'A,B') fail(`legend must list first-seen categories, got ${labels}`);
    if (swatches.length !== 2) fail(`want 2 legend swatches, got ${swatches.length}`);
    if (swatches.some((s) => !s.fill || !(s.w > 0 && s.h > 0))) fail('legend swatches need a fill and a size');

    const plotRight = WIDTH - 16;
    const plotBottom = HEIGHT - 16;
    for (const swatch of swatches) {
        if (swatch.x < WIDTH / 2) fail(`legend must sit at the plot right side: x=${swatch.x}`);
        if (swatch.x + swatch.w > plotRight) fail(`legend must stay inside the plot: x=${swatch.x}`);
        if (swatch.y + swatch.h > plotBottom - 16) fail('legend must stay clear of the x-axis labels');
    }

    const axisTextCount = axisStats(semantic).texts;
    if (count(svg, '<rect') !== colorRows.length + swatches.length) fail('legend swatches must serialize as <rect>');
    if (count(svg, '<text') !== axisTextCount + labels.length) fail('legend labels must serialize as <text>');
}

console.log('charts-render: text bounds are deterministic estimates…');
{
    const { display } = pipeline(barSpec, barRows);
    const texts = collectTexts(display.root);
    if (texts.length === 0) fail('display scene must carry axis text');
    const alpha = texts.find((t) => t.text === 'alpha');
    if (!alpha) fail('alpha tick label missing');
    // 5 chars × 10px × 0.6 wide, 1 line × 10px × 1.2 tall.
    if (Math.abs(alpha.bounds.w - 30) > 1e-9 || Math.abs(alpha.bounds.h - 12) > 1e-9) {
        fail(`alpha bounds want 30×12, got ${alpha.bounds.w}×${alpha.bounds.h}`);
    }
    if (Math.abs(alpha.bounds.x + alpha.bounds.w / 2 - alpha.anchor.x) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    if (Math.abs(alpha.bounds.y + alpha.bounds.h / 2 - alpha.anchor.y) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    if (alpha.fontCss !== '400 10px sans-serif') fail(`fontCss want "400 10px sans-serif", got "${alpha.fontCss}"`);
    if (texts.some((t) => !(t.bounds.w > 0 && t.bounds.h > 0))) fail('every text node needs non-zero bounds');
    if (texts.some((t) => !Number.isFinite(t.bounds.x) || !Number.isFinite(t.bounds.y))) {
        fail('text bounds must stay finite');
    }

    // CJK and half-width glyphs share one advance coefficient.
    const cjkSpec = {
        mark: 'bar',
        encoding: [
            { field: '类别', channel: 'x' },
            { field: '数值', channel: 'y' },
        ],
    };
    const { display: cjkDisplay } = pipeline(cjkSpec, [{ 类别: '图表', 数值: 2 }]);
    const cjk = collectTexts(cjkDisplay.root).find((t) => t.text === '图表');
    if (!cjk) fail('CJK tick label missing');
    if (Math.abs(cjk.bounds.w - 12) > 1e-9) fail(`CJK bounds want 12 wide, got ${cjk.bounds.w}`);
}

console.log('charts-render: empty data is not an error…');
{
    const { semantic, display, svg } = pipeline(barSpec, []);
    if (semantic.root.children.length !== 0) fail('empty data must produce no scene children');
    if (display.width !== WIDTH || display.height !== HEIGHT) fail('empty data must keep viewport');
    if (!svg.includes(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`)) fail('empty data must still emit viewBox');
    if (count(svg, '<rect') !== 0) fail('empty data must emit no marks');
    if (count(svg, '<text') !== 0) fail('empty data must emit no axis labels');
    if (svg.includes('NaN')) fail('empty data must not emit NaN');
}

console.log('charts-render: rendering is deterministic and escaped…');
{
    const { svg } = pipeline(barSpec, barRows);
    const again = pipeline(barSpec, barRows).svg;
    if (svg !== again) fail('renderSvg must be deterministic for identical scenes');
    if (/\d+\.\d{4,}/.test(svg)) fail(`numbers must stay at ≤3 decimals: ${svg.match(/\d+\.\d{4,}/)[0]}`);

    const id = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const textScene = {
        width: 20,
        height: 10,
        root: {
            kind: 'group',
            worldTransform: id,
            bounds: { x: 0, y: 0, w: 20, h: 10 },
            children: [
                {
                    kind: 'text',
                    worldTransform: id,
                    bounds: { x: 0, y: 0, w: 0, h: 0 },
                    text: '<a & "b">',
                    fontCss: '',
                    anchor: { x: 1, y: 2 },
                    color: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        },
    };
    const escaped = renderSvg(textScene);
    if (!escaped.includes('&lt;a &amp; &quot;b&quot;&gt;')) fail(`text must be escaped, got: ${escaped}`);
    if (!escaped.includes('viewBox="0 0 20 10"')) fail('manual scene viewBox wrong');
    if (!escaped.includes('text-anchor="middle"') || !escaped.includes('dominant-baseline="middle"')) {
        fail('text alignment attributes missing');
    }

    // Non-identity transforms still serialize as matrix().
    const moved = { ...textScene, root: { ...textScene.root, children: [{ ...textScene.root.children[0], worldTransform: { ...id, tx: 3, ty: 4 } }] } };
    if (!renderSvg(moved).includes('matrix(1,0,0,1,3,4)')) fail('non-identity transform must emit matrix()');
}

console.log('charts-render PASS: bar / line / point pipeline + axes, legend, text bounds, deterministic SVG');

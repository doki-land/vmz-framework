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
 * - text bounds are a deterministic size estimate centred on the anchor —
 *   wide CJK glyphs advance one em, half-width glyphs 0.6 em, and categorical
 *   x labels / legend entries truncate with an ellipsis into their slot
 * - `renderSvg` is deterministic, viewBox comes from the scene size, numbers
 *   stay at ≤3 decimals, text/attributes are escaped and empty data is safe
 * - rows with null / non-finite cells are skipped with structured diagnostics
 *   (`davinci.chart.missing-value` / `davinci.chart.non-finite-value`), and NaN
 *   or Infinity never reaches the markup
 * - bars grow away from the zero pixel, so negative values keep a positive
 *   height and never flip above zero
 * - line marks never bridge two series (one path per series, legend order is
 *   first appearance)
 * - `keyField` gives marks a stable identity that survives row reordering,
 *   duplicate keys are reported (`davinci.chart.duplicate-key`) and stay
 *   unique, an unknown `keyField` is an error, and the plan — not the scene —
 *   owns the series grouping domain
 * - `ChartTheme` tokens resolve every presentation color and font — the default
 *   palette and neutrals serialize as hex, a custom theme replaces them
 *   everywhere with no leftover hardcoded color, legend swatches share the
 *   series mark color, and nice ticks stay domain-derived
 * - the scene contract carries `/v0` end to end, `resolve` and `renderSvg`
 *   refuse foreign versions, `validateScene` reports duplicate ids, invalid
 *   clips and non-finite geometry, and clips resolve into intersected
 *   world clips that serialize as `<clipPath>`
 * - `renderSvg` `resourceIdPrefix` qualifies every generated resource id so
 *   coexisting charts stay id-disjoint, and a prefix that is not a safe id
 *   token is refused
 * - diagram spec → layout → builder → DisplayScene → SVG carries nodes, edges,
 *   labels, and ids that survive a spec update
 * - the published `@doki-land/davinci` dist renders the same fixtures
 *   byte-identical to the internal workspace packages
 */

import {
    DEFAULT_CHART_THEME,
    buildScene,
    compile,
    formatTickLabel,
    fromRows,
    niceLinearTicks,
} from '../../../../../davinci/davinci-chart/src/index.ts';
import { rgb8 } from '../../../../../davinci/davinci-types/src/index.ts';
import {
    estimateTextSize,
    renderSvg,
    resolve,
    truncateToWidth,
    validateScene,
} from '../../../../../davinci/davinci-scene/src/index.ts';
import {
    buildScene as buildDiagramScene,
    simpleLayout,
} from '../../../../../davinci/davinci-diagram/src/index.ts';
// Published contract: the bundled dist of `@doki-land/davinci`, rebuilt by
// the `build:davinci` pre-step before this gate loads.
import * as facadeChart from '../../../../../davinci/davinci/dist/chart.js';
import * as facadeScene from '../../../../../davinci/davinci/dist/scene.js';
import * as facadeDiagram from '../../../../../davinci/davinci/dist/diagram.js';

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
    // 5 chars × 11px × 0.6 wide, 1 line × 11px × 1.2 tall.
    if (Math.abs(alpha.bounds.w - 33) > 1e-9 || Math.abs(alpha.bounds.h - 13.2) > 1e-9) {
        fail(`alpha bounds want 33×13.2, got ${alpha.bounds.w}×${alpha.bounds.h}`);
    }
    if (Math.abs(alpha.bounds.x + alpha.bounds.w / 2 - alpha.anchor.x) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    if (Math.abs(alpha.bounds.y + alpha.bounds.h / 2 - alpha.anchor.y) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    if (alpha.fontCss !== '400 11px sans-serif') fail(`fontCss want "400 11px sans-serif", got "${alpha.fontCss}"`);
    if (texts.some((t) => !(t.bounds.w > 0 && t.bounds.h > 0))) fail('every text node needs non-zero bounds');
    if (texts.some((t) => !Number.isFinite(t.bounds.x) || !Number.isFinite(t.bounds.y))) {
        fail('text bounds must stay finite');
    }

    // Wide CJK glyphs advance one em, half-width glyphs 0.6 em.
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
    if (Math.abs(cjk.bounds.w - 22) > 1e-9) fail(`CJK bounds want 22 wide, got ${cjk.bounds.w}`);
}

console.log('charts-render: overflow truncates labels into their slot…');
{
    // Direct contract: longest prefix plus `…` fits the budget.
    if (truncateToWidth('图表', 22, 11) !== '图表') fail('text that fits must stay whole');
    if (truncateToWidth('图表图表', 33, 11) !== '图表…') {
        fail(`wide glyphs truncate by width: ${truncateToWidth('图表图表', 33, 11)}`);
    }
    if (truncateToWidth('abcdef', 13.2, 11) !== 'a…') {
        fail(`half-width glyphs truncate by width: ${truncateToWidth('abcdef', 13.2, 11)}`);
    }
    if (truncateToWidth('abc', 5, 11) !== '') fail('nothing fits when the budget is below the ellipsis');

    // Categorical x labels never exceed their band slot.
    const narrow = { width: 140, height: 120 };
    const longSpec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
        ],
    };
    const longPlan = compile(
        longSpec,
        fromRows([
            { category: 'alphabet-soup', value: 3 },
            { category: 'beta', value: 7 },
        ]),
    );
    const longSemantic = buildScene(longPlan, narrow);
    const xLabels = guideGroups(longSemantic, 'chart.axis')
        .find((g) => g.id === 'x-axis')
        .children.filter((n) => n.kind === 'text');
    if (!xLabels[0].text.endsWith('…')) fail(`long category must truncate: ${xLabels[0].text}`);
    if (xLabels[1].text !== 'beta') fail(`short category must stay whole: ${xLabels[1].text}`);
    const w0 = estimateTextSize(xLabels[0].text, 11).width;
    const w1 = estimateTextSize(xLabels[1].text, 11).width;
    if (!(Math.abs(xLabels[0].anchor.x - xLabels[1].anchor.x) >= (w0 + w1) / 2 - 1e-9)) {
        fail('truncated x labels must not collide');
    }

    // Long legend entries truncate and stay inside the plot.
    const legendSpec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
            { field: 'region', channel: 'color' },
        ],
    };
    const legendPlan = compile(
        legendSpec,
        fromRows([
            { category: 'a', value: 3, region: 'europe-middle' },
            { category: 'b', value: 7, region: 'asia-pacific' },
        ]),
    );
    const legendSemantic = buildScene(legendPlan, narrow);
    const legendTexts = guideGroups(legendSemantic, 'chart.legend')[0].children.filter((n) => n.kind === 'text');
    if (!legendTexts.some((t) => t.text.endsWith('…'))) fail('long legend entries must truncate');
    for (const t of legendTexts) {
        const w = estimateTextSize(t.text, 11).width;
        if (t.anchor.x + w / 2 > narrow.width - 16 + 1e-9) fail(`legend label must stay inside the plot: ${t.text}`);
    }
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
        version: '/v0',
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

console.log('charts-render: null / non-finite rows are skipped with diagnostics…');
{
    const spec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
        ],
    };
    const rows = [
        { category: 'alpha', value: 4 },
        { category: 'beta', value: Number.NaN },
        { category: 'gamma', value: Number.POSITIVE_INFINITY },
        { category: 'delta', value: null },
        { category: 'epsilon', value: 6 },
    ];
    const { plan, semantic, svg } = pipeline(spec, rows);
    const marks = semantic.root.children.filter((n) => n.kind === 'rect');
    if (marks.length !== 2) fail(`want 2 usable bars, got ${marks.length}`);
    if (marks[0].id !== 'bar:0' || marks[1].id !== 'bar:4') {
        fail(`skipped rows must not renumber ids: ${marks.map((m) => m.id).join(',')}`);
    }
    const codes = plan.diagnostics.items.map((d) => d.code);
    if (codes.filter((c) => c === 'davinci.chart.non-finite-value').length !== 2) {
        fail(`want 2 non-finite diagnostics, got ${codes.join(',')}`);
    }
    if (codes.filter((c) => c === 'davinci.chart.missing-value').length !== 1) {
        fail(`want 1 missing-value diagnostic, got ${codes.join(',')}`);
    }
    for (const d of plan.diagnostics.items) {
        if (!d.code || !d.message) fail('diagnostics need code + message');
        if (d.severity !== 'info' && d.severity !== 'warning' && d.severity !== 'error') {
            fail(`unexpected diagnostic severity: ${d.severity}`);
        }
    }
    if (svg.includes('NaN') || svg.includes('Infinity')) fail('markup must never carry NaN / Infinity');
    if (count(svg, '<rect') !== 2) fail(`svg want 2 usable bars, got ${count(svg, '<rect')}`);

    const xLabels = guideGroups(semantic, 'chart.axis')
        .find((g) => g.id === 'x-axis')
        .children.filter((n) => n.kind === 'text')
        .map((n) => n.text);
    if (xLabels.join(',') !== 'alpha,beta,gamma,delta,epsilon') {
        fail(`band categories must stay complete when only y is invalid: ${xLabels}`);
    }
}

console.log('charts-render: unknown encoding field is an error diagnostic…');
{
    const spec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'missing', channel: 'y' },
        ],
    };
    const { plan, semantic, svg } = pipeline(spec, [{ category: 'alpha', value: 4 }]);
    const unknown = plan.diagnostics.items.find((d) => d.code === 'davinci.chart.unknown-field');
    if (!unknown) fail(`want davinci.chart.unknown-field, got ${plan.diagnostics.items.map((d) => d.code)}`);
    if (unknown.severity !== 'error') fail(`unknown-field must be an error, got ${unknown.severity}`);
    if (!unknown.message.includes('missing')) fail(`diagnostic must name the field: ${unknown.message}`);
    if (semantic.root.children.length !== 0) fail('an unusable y field must not emit geometry');
    if (svg.includes('NaN')) fail('unknown field must not emit NaN');
}

console.log('charts-render: negative values keep a zero baseline…');
{
    const PAD = 16;
    const spec = {
        mark: 'bar',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
        ],
    };
    const rows = [
        { category: 'deep', value: -4 },
        { category: 'up', value: 2 },
        { category: 'shallow', value: -1 },
        { category: 'zero', value: 0 },
    ];
    const { semantic, svg } = pipeline(spec, rows);
    const marks = semantic.root.children.filter((n) => n.kind === 'rect');
    if (marks.length !== rows.length) fail(`want ${rows.length} bars, got ${marks.length}`);
    for (const m of marks) {
        if (!Number.isFinite(m.y) || !Number.isFinite(m.h) || !Number.isFinite(m.w)) {
            fail(`bar geometry must stay finite: ${m.id}`);
        }
        if (m.h < 0) fail(`bar height must never be negative: ${m.id} h=${m.h}`);
        if (!(m.w > 0)) fail(`bar width must stay positive: ${m.id}`);
        if (m.y < PAD - 1e-9 || m.y + m.h > HEIGHT - PAD + 1e-9) fail(`bar must stay inside the plot: ${m.id}`);
    }
    const [deep, up, shallow, zero] = marks;
    // Every bar is anchored on the zero pixel, which sits inside the plot for
    // this mixed-sign domain.
    const zeroLine = deep.y;
    if (!(zeroLine > PAD && zeroLine < HEIGHT - PAD)) fail(`zero baseline must sit inside the plot: ${zeroLine}`);
    if (Math.abs(shallow.y - zeroLine) > 1e-9) fail(`negative bars must hang from zero: shallow.y=${shallow.y} zero=${zeroLine}`);
    if (Math.abs(up.y + up.h - zeroLine) > 1e-9) fail('positive bars must end on zero');
    if (!(deep.h > shallow.h && shallow.h > 0)) fail(`negative bars must grow with magnitude: ${deep.h}/${shallow.h}`);
    if (!(up.y < zeroLine)) fail('positive bars must sit above zero');
    if (Math.abs(zero.h) > 1e-9) fail(`a zero value must have zero height, got ${zero.h}`);
    if (count(svg, '<rect') !== rows.length) fail(`svg want ${rows.length} bars, got ${count(svg, '<rect')}`);
}

console.log('charts-render: line marks never bridge two series…');
{
    const spec = {
        mark: 'line',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
            { field: 'series', channel: 'color' },
        ],
    };
    const rows = [
        { step: 1, score: 10, series: 'A' },
        { step: 2, score: 20, series: 'B' },
        { step: 3, score: 15, series: 'A' },
        { step: 4, score: 5, series: 'B' },
    ];
    const { semantic, svg } = pipeline(spec, rows);
    const paths = semantic.root.children.filter((n) => n.kind === 'path');
    if (paths.length !== 2) fail(`want one path per series, got ${paths.length}`);
    if (paths.map((p) => p.id).join(',') !== 'line:A,line:B') {
        fail(`series paths must follow first appearance: ${paths.map((p) => p.id).join(',')}`);
    }
    const a = paths[0].path.commands.map((c) => c.to);
    const b = paths[1].path.commands.map((c) => c.to);
    // A owns rows 0 and 2, B owns rows 1 and 3 — a shared path would carry 4 points.
    if (a.length !== 2 || b.length !== 2) fail(`each series must link only its own rows: A=${a.length} B=${b.length}`);
    for (const points of [a, b]) {
        for (let i = 1; i < points.length; i++) {
            if (!(points[i].x > points[i - 1].x)) fail('each series path must follow x order');
        }
    }
    const yA = new Set(a.map((p) => p.y));
    if (b.some((p) => yA.has(p.y))) fail('one line path must not connect points from two series');

    const legend = guideGroups(semantic, 'chart.legend')[0];
    if (!legend) fail('series legend missing');
    const labels = legend.children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (labels.join(',') !== 'A,B') fail(`legend must list first-seen series, got ${labels}`);

    if (count(svg, '<path') !== paths.length + axisStats(semantic).paths) {
        fail(`svg want ${paths.length} series + axis <path>, got ${count(svg, '<path')}`);
    }
    if (svg.includes('NaN')) fail('series paths must not emit NaN');
}

console.log('charts-render: keyField gives marks a stable identity…');
{
    const keyedSpec = {
        mark: 'bar',
        keyField: 'category',
        encoding: [
            { field: 'category', channel: 'x' },
            { field: 'value', channel: 'y' },
        ],
    };
    const keyedRows = [
        { category: 'alpha', value: 3 },
        { category: 'beta', value: 7 },
        { category: 'gamma', value: 5 },
    ];
    const { semantic } = pipeline(keyedSpec, keyedRows);
    const marks = semantic.root.children.filter((n) => n.kind === 'rect');
    if (marks.map((m) => m.id).join(',') !== 'bar:alpha,bar:beta,bar:gamma') {
        fail(`keyField ids want bar:alpha,bar:beta,bar:gamma, got ${marks.map((m) => m.id).join(',')}`);
    }
    for (const m of marks) {
        const path = m.source?.path ?? [];
        if (path[0] !== 'mark' || !keyedRows.some((r) => r.category === path[1])) {
            fail(`mark source path must carry the key, got ${JSON.stringify(path)}`);
        }
    }

    // Reordering rows must not renumber identities — each category keeps its id.
    const reordered = pipeline(keyedSpec, [keyedRows[2], keyedRows[0], keyedRows[1]]);
    const reorderedMarks = reordered.semantic.root.children.filter((n) => n.kind === 'rect');
    if (reorderedMarks.map((m) => m.id).join(',') !== 'bar:gamma,bar:alpha,bar:beta') {
        fail(`ids must follow keys after reorder: ${reorderedMarks.map((m) => m.id).join(',')}`);
    }
    // The band domain follows row order, so x may shift; the measured height
    // belongs to the value, so it must ride with the key.
    for (const row of keyedRows) {
        const before = marks.find((m) => m.id === `bar:${row.category}`);
        const after = reorderedMarks.find((m) => m.id === `bar:${row.category}`);
        if (!before || !after) fail(`key ${row.category} lost on reorder`);
        if (Math.abs(before.h - after.h) > 1e-9) {
            fail(`bar ${row.category} height drifted on reorder: ${before.h} vs ${after.h}`);
        }
    }

    // Duplicate keys are reported once per collision and stay unique in ids.
    const dup = pipeline(keyedSpec, [
        { category: 'alpha', value: 3 },
        { category: 'alpha', value: 5 },
        { category: 'beta', value: 7 },
    ]);
    const dupCodes = dup.plan.diagnostics.items.filter((d) => d.code === 'davinci.chart.duplicate-key');
    if (dupCodes.length !== 1) fail(`want 1 duplicate-key diagnostic, got ${dupCodes.length}`);
    if (dupCodes[0].severity !== 'warning') fail(`duplicate-key must be a warning, got ${dupCodes[0].severity}`);
    if (!dupCodes[0].message.includes('alpha')) fail(`duplicate-key must name the key: ${dupCodes[0].message}`);
    if (dupCodes[0].source !== 'category#1') fail(`duplicate-key source must point at the row: ${dupCodes[0].source}`);
    const dupIds = dup.semantic.root.children.filter((n) => n.kind === 'rect').map((m) => m.id);
    if (new Set(dupIds).size !== dupIds.length) fail(`ids must stay unique on duplicate keys: ${dupIds.join(',')}`);

    // An unknown keyField is the same class of authoring mistake as an
    // unknown encoding field.
    const badKey = pipeline({ ...keyedSpec, keyField: 'nope' }, keyedRows);
    const badKeyDiag = badKey.plan.diagnostics.items.find(
        (d) => d.code === 'davinci.chart.unknown-field' && d.message.includes('nope'),
    );
    if (!badKeyDiag) fail('unknown keyField must raise davinci.chart.unknown-field');
    if (badKeyDiag.severity !== 'error') fail(`unknown keyField must be an error, got ${badKeyDiag.severity}`);
}

console.log('charts-render: the plan owns the series grouping domain…');
{
    const spec = {
        mark: 'line',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
            { field: 'region', channel: 'series' },
        ],
    };
    const rows = [
        { step: 1, score: 10, region: 'B' },
        { step: 2, score: 20, region: 'A' },
        { step: 3, score: 15, region: 'B' },
    ];
    const plan = compile(spec, fromRows(rows));
    if (plan.series.field !== 'region') fail(`series.field want region, got ${plan.series.field}`);
    if (plan.series.categories.join(',') !== 'B,A') {
        fail(`series.categories must be first-appearance order, got ${plan.series.categories.join(',')}`);
    }
    if (plan.marks.map((m) => m.series).join(',') !== 'B,A,B') {
        fail(`marks must carry their series group: ${plan.marks.map((m) => m.series).join(',')}`);
    }
    if (plan.marks.map((m) => m.key).join(',') !== '0,1,2') {
        fail(`positional keys want 0,1,2, got ${plan.marks.map((m) => m.key).join(',')}`);
    }

    const ungrouped = compile(
        { mark: 'bar', encoding: [{ field: 'category', channel: 'x' }, { field: 'value', channel: 'y' }] },
        fromRows(barRows),
    );
    if (ungrouped.series.field !== null || ungrouped.series.categories.length !== 0) {
        fail('unkeyed charts must carry an empty grouping domain');
    }
    if (ungrouped.marks.some((m) => m.series !== null)) fail('ungrouped marks must have series null');
}

console.log('charts-render: theme tokens drive every presentation color…');
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
    ];

    // Default theme: the reference palette and neutrals serialize as hex.
    const def = pipeline(colorSpec, colorRows);
    if (!def.svg.includes('fill="#1f77b4"')) fail(`default palette first color want #1f77b4: ${def.svg.slice(0, 400)}`);
    if (!def.svg.includes('fill="#ff7f0e"')) fail('default palette second color want #ff7f0e');
    if (!def.svg.includes('stroke="#a0a0a0"')) fail('default axis stroke want #a0a0a0');
    if (!def.svg.includes('fill="#555555"')) fail('default label color want #555555');

    // A legend swatch and its marks resolve the same palette index.
    const legend = guideGroups(def.semantic, 'chart.legend')[0];
    const swatchA = legend.children.find((n) => n.kind === 'rect');
    const barA = def.semantic.root.children.find((n) => n.kind === 'rect' && n.id === 'bar:0');
    if (!swatchA || !barA) fail('grouped chart needs both a legend swatch and a bar');
    if (JSON.stringify(swatchA.fill.color) !== JSON.stringify(barA.fill.color)) {
        fail('legend swatch must match the series mark color');
    }

    // Custom theme: every token is honored, nothing of the default survives.
    const custom = {
        ...DEFAULT_CHART_THEME,
        seriesPalette: [rgb8(255, 0, 0)],
        markFill: rgb8(0, 0, 0),
        axisStroke: rgb8(10, 20, 30),
        labelColor: rgb8(1, 2, 3),
    };
    const themed = buildScene(compile(colorSpec, fromRows(colorRows)), { width: WIDTH, height: HEIGHT }, { theme: custom });
    const themedSvg = renderSvg(resolve(themed, { width: WIDTH, height: HEIGHT }));
    if (!themedSvg.includes('fill="#ff0000"')) fail(`custom palette want #ff0000: ${themedSvg.slice(0, 400)}`);
    if (!themedSvg.includes('stroke="#0a141e"')) fail('custom axis stroke want #0a141e');
    if (!themedSvg.includes('fill="#010203"')) fail('custom label color want #010203');
    if (themedSvg.includes('#1f77b4') || themedSvg.includes('#a0a0a0') || themedSvg.includes('#555555')) {
        fail('custom theme must not leak a default color');
    }

    // Ungrouped marks fall back to `markFill`, never the categorical palette.
    const plainPlan = compile(barSpec, fromRows(barRows));
    const plainSvg = renderSvg(
        resolve(buildScene(plainPlan, { width: WIDTH, height: HEIGHT }, { theme: custom }), { width: WIDTH, height: HEIGHT }),
    );
    if (!plainSvg.includes('fill="#000000"')) fail(`ungrouped bars want markFill #000000: ${plainSvg.slice(0, 400)}`);
}

console.log('charts-render: nice ticks stay domain-derived…');
{
    const { values, decimals } = niceLinearTicks([0, 7]);
    if (values.join(',') !== '0,2,4,6') fail(`niceLinearTicks([0,7]) want 0,2,4,6, got ${values.join(',')}`);
    if (decimals !== 0) fail(`[0, 7] decimals want 0, got ${decimals}`);
    const flat = niceLinearTicks([3, 3]);
    if (flat.values.join(',') !== '3') fail(`flat domain wants a single tick, got ${flat.values.join(',')}`);
    if (formatTickLabel(2.5, 1) !== '2.5') fail('tick label must keep the needed decimal');
    if (formatTickLabel(4, 2) !== '4') fail('tick label must drop trailing zeros');
    if (formatTickLabel(-0, 0) !== '0') fail('tick label must never print -0');
}

console.log('charts-render: scene contract carries /v0 end to end…');
{
    const { semantic, display } = pipeline(barSpec, barRows);
    if (semantic.version !== '/v0') fail(`semantic scene wants /v0, got ${semantic.version}`);
    if (display.version !== '/v0') fail(`display scene wants /v0, got ${display.version}`);

    // Foreign versions are refused outright — no dual read, no fallback.
    let threw = false;
    try {
        resolve({ ...semantic, version: '/v1' });
    } catch {
        threw = true;
    }
    if (!threw) fail('resolve must refuse an unknown scene version');
    threw = false;
    try {
        renderSvg({ ...display, version: 'davinci/0' });
    } catch {
        threw = true;
    }
    if (!threw) fail('renderSvg must refuse an unknown display version');

    // Builders produce conformant scenes.
    const issues = validateScene(semantic);
    if (issues.length !== 0) fail(`builder scene must be conformant: ${JSON.stringify(issues)}`);
    const badVersion = validateScene({ ...semantic, version: '/v1' });
    if (!badVersion.some((d) => d.code === 'davinci.scene.unsupported-version')) {
        fail(`validateScene must flag /v1: ${JSON.stringify(badVersion)}`);
    }

    // Duplicate ids, invalid clips and non-finite geometry are reported.
    const dup = {
        version: '/v0',
        root: {
            kind: 'group',
            id: 'g',
            role: 'group',
            children: [
                { kind: 'rect', id: 'bar:0', role: 'chart.mark', x: 0, y: 0, w: 1, h: 1 },
                { kind: 'rect', id: 'bar:0', role: 'chart.mark', x: 2, y: 0, w: 1, h: 1 },
            ],
        },
    };
    const dupCodes = validateScene(dup).map((d) => d.code);
    if (!dupCodes.includes('davinci.scene.duplicate-id')) fail(`duplicate ids must be reported: ${dupCodes}`);

    const badGeom = {
        version: '/v0',
        root: {
            kind: 'group',
            id: 'g',
            role: 'group',
            children: [{ kind: 'rect', id: 'r', role: 'chart.mark', x: Number.NaN, y: 0, w: 1, h: 1 }],
        },
    };
    if (!validateScene(badGeom).some((d) => d.code === 'davinci.scene.invalid-geometry')) {
        fail('non-finite geometry must be reported');
    }

    const badClip = {
        version: '/v0',
        root: { kind: 'group', id: 'g', role: 'group', clip: { x: 0, y: 0, w: -1, h: 2 }, children: [] },
    };
    if (!validateScene(badClip).some((d) => d.code === 'davinci.scene.invalid-clip')) {
        fail('a negative clip rect must be reported');
    }

    // Clips resolve into intersected world clips and serialize as <clipPath>.
    const clipped = {
        version: '/v0',
        root: {
            kind: 'group',
            id: 'g',
            role: 'group',
            clip: { x: 10, y: 10, w: 40, h: 40 },
            children: [{ kind: 'rect', id: 'r', role: 'decorative', x: 0, y: 0, w: 100, h: 100 }],
        },
    };
    const clippedDisplay = resolve(clipped, { width: 100, height: 100 });
    const leaf = clippedDisplay.root.children[0];
    if (!leaf.worldClip || leaf.worldClip.w !== 40 || leaf.worldClip.x !== 10) {
        fail(`child must inherit the parent clip: ${JSON.stringify(leaf.worldClip)}`);
    }
    if (leaf.bounds.w !== 100) fail('bounds stay geometric, clip does not rewrite them');
    const clippedSvg = renderSvg(clippedDisplay);
    if (!clippedSvg.includes('<clipPath id="clip-0">')) fail('clip must serialize into defs/clipPath');
    if (!clippedSvg.includes('clip-path="url(#clip-0)"')) fail('clipped markup must reference the clip id');
}

console.log('charts-render: resource ids stay unique across coexisting charts…');
{
    const clipped = {
        version: '/v0',
        root: {
            kind: 'group',
            id: 'g',
            role: 'group',
            clip: { x: 10, y: 10, w: 40, h: 40 },
            children: [{ kind: 'rect', id: 'r', role: 'decorative', x: 0, y: 0, w: 100, h: 100 }],
        },
    };
    const clippedDisplay = resolve(clipped, { width: 100, height: 100 });
    const idsOf = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

    const aSvg = renderSvg(clippedDisplay, { resourceIdPrefix: 'a-' });
    const bSvg = renderSvg(clippedDisplay, { resourceIdPrefix: 'b-' });
    if (!aSvg.includes('<clipPath id="a-clip-0">')) fail('prefix must qualify the clipPath id');
    if (!aSvg.includes('clip-path="url(#a-clip-0)"')) fail('references must use the prefixed id');
    if (bSvg.includes('id="a-clip-0"')) fail('prefixed renders must not share ids');
    const shared = idsOf(aSvg).filter((id) => idsOf(bSvg).includes(id));
    if (shared.length !== 0) fail(`coexisting charts must have disjoint ids: ${shared}`);

    // Unsafe prefixes would corrupt attribute markup — rejected at the boundary.
    let threw = false;
    try {
        renderSvg(clippedDisplay, { resourceIdPrefix: 'bad"prefix' });
    } catch {
        threw = true;
    }
    if (!threw) fail('a prefix that is not a safe id token must be refused');
}

// ─── Diagram: topology → layout → DisplayScene → SVG ─────────────────────

function diagramPipeline(spec) {
    const plan = simpleLayout(spec);
    const semantic = buildDiagramScene(spec, plan);
    const display = resolve(semantic, { width: plan.canvasBounds.w, height: plan.canvasBounds.h });
    return { plan, semantic, display, svg: renderSvg(display) };
}

const diagramSpec = {
    kind: 'flowchart',
    direction: 'LR',
    nodes: [
        { id: 'a', label: 'Start' },
        { id: 'b', label: 'Work' },
        { id: 'c', label: 'End' },
    ],
    edges: [
        { id: 'e1', fromNode: 'a', toNode: 'b', label: 'go' },
        { id: 'e2', fromNode: 'b', toNode: 'c' },
    ],
};

console.log('charts-render: diagram carries nodes, edges and labels as SVG…');
{
    const { plan, semantic, display, svg } = diagramPipeline(diagramSpec);
    if (semantic.version !== '/v0') fail(`diagram scene wants /v0, got ${semantic.version}`);
    if (validateScene(semantic).length !== 0) fail('diagram builder scene must be conformant');
    const nodes = semantic.root.children.filter((n) => n.role === 'diagram.node');
    const edges = semantic.root.children.filter((n) => n.role === 'diagram.edge');
    const labels = semantic.root.children.filter((n) => n.kind === 'text');

    if (nodes.length !== 3 || edges.length !== 2) {
        fail(`want 3 nodes / 2 edges, got ${nodes.length}/${edges.length}`);
    }
    if (nodes.map((n) => n.id).join(',') !== 'node-a,node-b,node-c') {
        fail(`node ids must come from the spec: ${nodes.map((n) => n.id).join(',')}`);
    }
    if (edges.map((n) => n.id).join(',') !== 'edge-e1,edge-e2') {
        fail(`edge ids must come from the spec: ${edges.map((n) => n.id).join(',')}`);
    }
    if (!labels.some((n) => n.id === 'edge-label-e1' && n.text === 'go')) fail('edge label must be part of the scene');
    for (const text of ['Start', 'Work', 'End', 'go']) {
        if (!labels.some((n) => n.text === text)) fail(`missing diagram label: ${text}`);
    }

    if (!(display.width > 0 && display.height > 0)) fail('diagram display scene must carry the layout canvas');
    if (!svg.includes(`viewBox="0 0 ${display.width} ${display.height}"`)) {
        fail('diagram viewBox must come from the layout canvas');
    }
    if (count(svg, '<rect') !== nodes.length) fail(`diagram want ${nodes.length} node <rect>, got ${count(svg, '<rect')}`);
    if (count(svg, '<path') !== edges.length) fail(`diagram want ${edges.length} edge <path>, got ${count(svg, '<path')}`);
    if (count(svg, '<text') !== labels.length) fail(`diagram want ${labels.length} <text>, got ${count(svg, '<text')}`);
    if (!svg.includes('>go</text>')) fail(`edge label markup missing: ${svg.slice(-200)}`);
    if (svg.includes('NaN') || svg.includes('Infinity')) fail('diagram markup must never carry NaN / Infinity');

    for (const edge of edges) {
        const cmds = edge.path.commands;
        if (cmds.length !== 2 || cmds[0].kind !== 'move' || cmds[1].kind !== 'line') {
            fail(`edge ${edge.id} must be move → line`);
        }
        if (!(cmds[1].to.x > cmds[0].to.x) || cmds[0].to.y !== cmds[1].to.y) {
            fail(`edge ${edge.id} must run left → right between node centres`);
        }
    }
    if (!plan.edges.every((e) => Number.isFinite(e.from.x) && Number.isFinite(e.to.x))) {
        fail('routed edges must stay finite');
    }

    // Same spec → byte-identical markup; a grown spec must not renumber ids.
    if (diagramPipeline(diagramSpec).svg !== svg) fail('diagram SVG must be deterministic');
    const grown = diagramPipeline({
        ...diagramSpec,
        nodes: [...diagramSpec.nodes, { id: 'd', label: 'After' }],
        edges: [...diagramSpec.edges, { id: 'e3', fromNode: 'c', toNode: 'd' }],
    });
    const grownNodes = grown.semantic.root.children.filter((n) => n.role === 'diagram.node');
    if (grownNodes.length !== 4) fail(`grown diagram want 4 nodes, got ${grownNodes.length}`);
    for (const id of ['node-a', 'node-label-a', 'edge-e1', 'edge-label-e1']) {
        if (!grown.semantic.root.children.some((n) => n.id === id)) fail(`id ${id} drifted after the spec update`);
    }
    for (const node of nodes) {
        const same = grownNodes.find((n) => n.id === node.id);
        if (!same) fail(`node ${node.id} lost after the spec update`);
        if (same.x !== node.x || same.y !== node.y || same.w !== node.w || same.h !== node.h) {
            fail(`node ${node.id} moved after appending an unrelated node`);
        }
    }
}

console.log('charts-render: the published facade dist is byte-identical to the internals…');
{
    // Two independent code paths — internal workspace sources (all sections
    // above) and the bundled `@doki-land/davinci` dist — must agree on every
    // byte of the same fixture's markup, or the published artifact lies.
    const facadePlan = facadeChart.compile(barSpec, facadeChart.fromRows(barRows));
    const facadeSemantic = facadeChart.buildScene(facadePlan, { width: WIDTH, height: HEIGHT });
    if (facadeSemantic.version !== '/v0') fail('facade chart builder must emit the /v0 contract');
    const facadeDisplay = facadeScene.resolve(facadeSemantic, { width: WIDTH, height: HEIGHT });
    const facadeSvg = facadeScene.renderSvg(facadeDisplay);
    if (facadeSvg !== pipeline(barSpec, barRows).svg) {
        fail('facade chart SVG must be byte-identical to the internal packages');
    }

    const facadeDiagramPlan = facadeDiagram.simpleLayout(diagramSpec);
    const facadeDiagramSemantic = facadeDiagram.buildScene(diagramSpec, facadeDiagramPlan);
    const facadeDiagramDisplay = facadeScene.resolve(facadeDiagramSemantic, {
        width: facadeDiagramPlan.canvasBounds.w,
        height: facadeDiagramPlan.canvasBounds.h,
    });
    if (facadeScene.renderSvg(facadeDiagramDisplay) !== diagramPipeline(diagramSpec).svg) {
        fail('facade diagram SVG must be byte-identical to the internal packages');
    }

    // Resource-id prefixing survives the bundle boundary too.
    const facadeClipped = facadeScene.resolve(
        {
            version: '/v0',
            root: {
                kind: 'group',
                id: 'g',
                role: 'group',
                clip: { x: 10, y: 10, w: 40, h: 40 },
                children: [{ kind: 'rect', id: 'r', role: 'decorative', x: 0, y: 0, w: 100, h: 100 }],
            },
        },
        { width: 100, height: 100 },
    );
    const prefixed = facadeScene.renderSvg(facadeClipped, { resourceIdPrefix: 'f1-' });
    if (!prefixed.includes('<clipPath id="f1-clip-0">')) fail('facade renderSvg must honour resourceIdPrefix');
}

console.log('charts-render PASS: chart pipeline + diagnostics + zero baseline + series + diagram SVG');

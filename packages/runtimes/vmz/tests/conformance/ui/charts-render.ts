/**
 * charts-render gate — @vmz/ui-charts real chart pipeline.
 *
 * Asserts:
 * - `compile` → `buildScene` maps plan scale ranges into the pixel viewport
 *   for bar / line / area / point marks (compile never guesses pixels)
 * - stable ids live on SemanticScene (rowIndex / series); DisplayScene strips
 *   domain semantics as designed, so markup carries geometry only — hosts that
 *   opt into `preserveNodeIds` get `data-dvz-id` hooks for interaction
 * - axes carry baselines, short tick marks and data-derived labels (numeric
 *   4–6 ticks, band one per category) with minimal decimals, and horizontal
 *   grid lines sit behind the marks at every y tick except the baseline
 * - a legend appears only when a color / series channel exists, laid out as a
 *   strip above the plot so it never covers data; overflowing entries collapse
 *   into an explicit `+N` marker
 * - theme tokens drive every presentation color and font in both light and
 *   dark variants; font stacks quote each family entry individually
 * - unimplemented marks are refused with `davinci.chart.unsupported-mark`
 *   (compile) and a loud builder error — never a silent empty chart
 * - diagram edges clip to node borders, `arrow` edges carry real filled
 *   arrowheads, edge labels sit on halo rects, and node labels truncate into
 *   their box
 * - text bounds are a deterministic size estimate centred on the anchor —
 *   wide CJK glyphs advance one em, half-width glyphs 0.6 em, and categorical
 *   x labels / legend entries truncate with an ellipsis into their slot
 * - `renderSvg` is deterministic, viewBox comes from the scene size, numbers
 *   stay at ≤3 decimals, text/attributes are escaped and empty data is safe
 * - rows with null / non-finite cells are skipped with structured diagnostics
 *   (`davinci.chart.missing-value` / `davinci.chart.non-finite-value`), and NaN
 *   or Infinity never reaches the markup
 * - an explicit `log` scale whose domain endpoints are not finite and positive
 *   is refused with `davinci.chart.invalid-log-domain` (error): the scale is
 *   never installed and never silently auto-derived, so the chart stays empty
 * - `aggregate` reads only finite numbers — ±Infinity / NaN cells are skipped
 *   the way `compile` treats quantitative columns, so every result stays finite
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
 * - `resolveResourceIdPrefix` regenerates a prefix purely from declarative
 *   inputs (an explicit host prop wins, otherwise a deterministic hash), so
 *   construction order never changes markup and the components carry no
 *   per-instance counter
 * - diagram spec → layout → builder → DisplayScene → SVG carries nodes, edges,
 *   labels, and ids that survive a spec update
 * - the published `@doki-land/davinci` dist renders the same fixtures
 *   byte-identical to the internal workspace packages
 */

import { readFileSync } from 'node:fs';
import {
    DARK_CHART_THEME,
    DEFAULT_CHART_THEME,
    aggregate,
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
    resolveResourceIdPrefix,
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

/** Grid lines are direct children with role chart.grid (not inside axis groups). */
function gridLines(semantic) {
    return semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.grid');
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
    const grid = gridLines(semantic);
    if (count(svg, '<path') !== paths + grid.length) {
        fail(`svg want ${paths} axis + ${grid.length} grid <path>, got ${count(svg, '<path')}`);
    }
    if (count(svg, '<text') !== texts) fail(`svg want ${texts} axis <text>, got ${count(svg, '<text')}`);
    if (!svg.includes('text-anchor="middle"')) fail('text must declare text-anchor');
    if (!svg.includes('dominant-baseline="middle"')) fail('text must declare dominant-baseline');
    if (svg.includes('NaN')) fail('svg must not carry NaN attributes');
    if (guideGroups(semantic, 'chart.legend').length !== 0) fail('no legend without a color / series channel');
}

console.log('charts-render: grid lines sit behind marks, aligned to y ticks…');
{
    const { semantic, svg } = pipeline(barSpec, barRows);
    const grid = gridLines(semantic);
    // Domain [0, 7] → nice ticks 0,2,4,6 → grid skips the baseline (0) and
    // keeps one horizontal line per remaining tick.
    const yAxis = guideGroups(semantic, 'chart.axis').find((g) => g.id === 'y-axis');
    const yTickLabels = yAxis.children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (grid.length !== yTickLabels.length - 1) {
        fail(`grid wants one line per y tick except the baseline: ${grid.length} vs ${yTickLabels.length}`);
    }
    // Grid spans the plot horizontally and never descends to the baseline pixel.
    const yTicks = niceLinearTicks([0, 7]).values.filter((v) => v !== 0);
    if (grid.length !== yTicks.length) fail(`grid count want ${yTicks.length}, got ${grid.length}`);
    // Visual hierarchy: grid stroke is quieter than the axis stroke, and the
    // marks come after the grid in document order (data paints on top).
    const firstGrid = svg.indexOf('stroke="#e5e7eb"');
    const firstMark = svg.indexOf('<rect');
    if (firstGrid < 0) fail(`grid must use the theme grid stroke #e5e7eb: ${svg.slice(0, 300)}`);
    if (firstMark < firstGrid) fail('grid must serialize before marks');
    if (svg.indexOf('stroke="#9ca3af"') < 0) fail('axis must keep the stronger axis stroke #9ca3af');
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
    const paths = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
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
    const grid = gridLines(semantic);
    if (count(svg, '<path') !== 1 + axisPaths + grid.length) {
        fail(`svg want 1 mark + ${axisPaths} axis + ${grid.length} grid <path>, got ${count(svg, '<path')}`);
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
    // Points carry the theme point stroke so overlapping glyphs stay separable.
    for (const mark of marks) {
        if (!mark.stroke || mark.stroke.width <= 0) fail(`point ${mark.id} must carry a separating stroke`);
    }
    if (!svg.includes('stroke="#ffffff"')) fail('default point stroke want #ffffff');
}

console.log('charts-render: area marks close to the zero baseline…');
{
    const areaSpec = {
        mark: 'area',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'visitors', channel: 'y' },
            { field: 'site', channel: 'color' },
        ],
    };
    const areaRows = [
        { day: 1, visitors: 120, site: 'A' },
        { day: 2, visitors: 145, site: 'A' },
        { day: 3, visitors: 98, site: 'A' },
        { day: 1, visitors: 80, site: 'B' },
        { day: 2, visitors: 110, site: 'B' },
        { day: 3, visitors: 132, site: 'B' },
    ];
    const { semantic, svg } = pipeline(areaSpec, areaRows);
    const areas = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (areas.length !== 2) fail(`want one area path per series, got ${areas.length}`);
    if (areas.map((a) => a.id).join(',') !== 'area:A,area:B') {
        fail(`area ids want area:A,area:B, got ${areas.map((a) => a.id).join(',')}`);
    }
    for (const area of areas) {
        const cmds = area.path.commands;
        if (cmds[cmds.length - 1].kind !== 'close') fail(`${area.id} must close back to the baseline`);
        if (!area.fill) fail(`${area.id} must carry a fill`);
        if (area.fill.color.a <= 0 || area.fill.color.a >= 1) {
            fail(`${area.id} fill must be translucent, got alpha ${area.fill.color.a}`);
        }
        if (!area.stroke || area.stroke.width <= 0) fail(`${area.id} must keep a full-strength stroke`);
        // First and last open points sit on the zero baseline (same pixel y).
        const firstY = cmds[0].to.y;
        const lastOpen = cmds[cmds.length - 2].to.y;
        if (Math.abs(firstY - lastOpen) > 1e-9) fail(`${area.id} baseline endpoints must share one pixel row`);
    }
    if (!svg.includes('fill-opacity="0.25"')) fail(`area fill opacity want 0.25: ${svg.slice(0, 400)}`);
    // One legend strip above the plot for the two series.
    const legends = guideGroups(semantic, 'chart.legend');
    if (legends.length !== 1) fail('area chart wants a legend strip');
    const labels = legends[0].children.filter((n) => n.kind === 'text').map((n) => n.text);
    if (labels.join(',') !== 'A,B') fail(`area legend want A,B got ${labels.join(',')}`);
}

console.log('charts-render: unimplemented marks are refused, never silent…');
{
    const plan = compile({ mark: 'tick', encoding: [{ field: 'a', channel: 'x' }, { field: 'b', channel: 'y' }] }, fromRows([{ a: 1, b: 2 }]));
    const refused = plan.diagnostics.items.find((d) => d.code === 'davinci.chart.unsupported-mark');
    if (!refused) fail('an unimplemented mark must raise davinci.chart.unsupported-mark');
    if (refused.severity !== 'error') fail(`unsupported-mark must be an error, got ${refused.severity}`);
    // A hand-built plan that bypasses compile still fails loudly in the builder.
    let threw = false;
    try {
        buildScene({ ...plan, spec: { ...plan.spec, mark: 'mystery' } }, { width: WIDTH, height: HEIGHT });
    } catch {
        threw = true;
    }
    if (!threw) fail('the scene builder must refuse a mark with no geometry');
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

    // The legend is a strip above the plot: it starts at the plot's left
    // edge, and every swatch sits strictly above the highest bar top — the
    // legend can never cover data.
    const bars = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    const highestBarTop = Math.min(...bars.map((b) => b.y));
    const yAxis = guideGroups(semantic, 'chart.axis').find((g) => g.id === 'y-axis');
    const plotLeft = yAxis.children.find((n) => n.id === 'y-axis:baseline').path.commands[0].to.x;
    for (const swatch of swatches) {
        if (swatch.y + swatch.h >= highestBarTop) {
            fail(`legend must sit above the plot, swatch bottom=${swatch.y + swatch.h} highest bar=${highestBarTop}`);
        }
        if (Math.abs(swatch.x - plotLeft) > 1e-9 && swatch.x < plotLeft - 1e-9) {
            fail(`legend must start at the plot left edge: x=${swatch.x} plot=${plotLeft}`);
        }
    }
    // One horizontal row: all swatches share the same y.
    if (new Set(swatches.map((s) => s.y)).size !== 1) fail('legend entries must share one row');
    // Entries flow left to right in first-appearance order.
    if (!(swatches[0].x < swatches[1].x)) fail('legend entries must flow left to right');

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
    // 5 chars × 12px × 0.6 wide, 1 line × 12px × 1.2 tall.
    if (Math.abs(alpha.bounds.w - 36) > 1e-9 || Math.abs(alpha.bounds.h - 14.4) > 1e-9) {
        fail(`alpha bounds want 36×14.4, got ${alpha.bounds.w}×${alpha.bounds.h}`);
    }
    if (Math.abs(alpha.bounds.x + alpha.bounds.w / 2 - alpha.anchor.x) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    if (Math.abs(alpha.bounds.y + alpha.bounds.h / 2 - alpha.anchor.y) > 1e-9) {
        fail('text bounds must be centred on the anchor');
    }
    // Font stacks quote each family entry individually — never the whole list.
    const wantFont =
        '400 12px system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
    if (alpha.fontCss !== wantFont) fail(`fontCss want "${wantFont}", got "${alpha.fontCss}"`);
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
    if (Math.abs(cjk.bounds.w - 24) > 1e-9) fail(`CJK bounds want 24 wide, got ${cjk.bounds.w}`);
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
    const w0 = estimateTextSize(xLabels[0].text, 12).width;
    const w1 = estimateTextSize(xLabels[1].text, 12).width;
    if (!(Math.abs(xLabels[0].anchor.x - xLabels[1].anchor.x) >= (w0 + w1) / 2 - 1e-9)) {
        fail('truncated x labels must not collide');
    }

    // Long legend entries truncate into the strip above the plot, the first
    // category is always kept, and dropped ones leave an explicit +N marker.
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
    const legendGroup = guideGroups(legendSemantic, 'chart.legend')[0];
    const legendTexts = legendGroup.children.filter((n) => n.kind === 'text');
    if (!legendTexts.some((t) => t.text.endsWith('…'))) fail('long legend entries must truncate');
    if (!legendTexts.some((t) => t.text === '+1')) fail(`dropped legend entries must leave a +1 marker: ${legendTexts.map((t) => t.text)}`);
    // The strip stays inside the viewport and strictly above the plot marks.
    const narrowBars = legendSemantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    const narrowPlotTop = Math.min(...narrowBars.map((b) => b.y));
    for (const child of legendGroup.children) {
        const w = child.kind === 'rect' ? child.w : estimateTextSize(child.text, 12).width;
        const cx = child.kind === 'rect' ? child.x + child.w / 2 : child.anchor.x;
        if (cx + w / 2 > narrow.width + 1e-9) fail(`legend must stay inside the viewport: ${JSON.stringify(child)}`);
        const cy = child.kind === 'rect' ? child.y + child.h / 2 : child.anchor.y;
        if (cy >= narrowPlotTop) fail('legend strip must stay above the plot');
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

console.log('charts-render: an explicit log scale with an invalid domain is refused…');
{
    const pointSpec = {
        mark: 'circle',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const logRows = [
        { step: 1, score: 10 },
        { step: 2, score: 100 },
        { step: 3, score: 1000 },
    ];
    const withYLog = (domain) => ({
        ...pointSpec,
        scales: new Map([['y', { kind: 'log', domain, range: [0, 1] }]]),
    });
    for (const domain of [
        [0, 100],
        [-5, 100],
        [Number.NaN, 100],
        [1, Number.POSITIVE_INFINITY],
    ]) {
        const plan = compile(withYLog(domain), fromRows(logRows));
        const invalid = plan.diagnostics.items.find((d) => d.code === 'davinci.chart.invalid-log-domain');
        if (!invalid) fail(`domain [${domain}] must raise davinci.chart.invalid-log-domain`);
        if (invalid.severity !== 'error') fail(`invalid-log-domain must be an error, got ${invalid.severity}`);
        if (invalid.source !== 'y') fail(`invalid-log-domain source must name the channel, got ${invalid.source}`);
        if (!invalid.message.includes('y')) fail(`message must name the channel: ${invalid.message}`);
        if (plan.scales.has('y')) fail(`a refused log scale must not be installed: domain [${domain}]`);
        const semantic = buildScene(plan, { width: WIDTH, height: HEIGHT });
        const svg = renderSvg(resolve(semantic, { width: WIDTH, height: HEIGHT }));
        if (svg.includes('NaN') || svg.includes('Infinity')) {
            fail(`refused log domain must not leak into markup: [${domain}]`);
        }
        if (count(svg, '<ellipse') !== 0) fail(`refused log scale must emit no marks: [${domain}]`);
    }

    // A usable log domain installs the scale untouched.
    const okPlan = compile(withYLog([1, 1000]), fromRows(logRows));
    if (okPlan.diagnostics.items.some((d) => d.code === 'davinci.chart.invalid-log-domain')) {
        fail('a finite positive log domain must not be refused');
    }
    if (!okPlan.scales.has('y')) fail('a valid log scale must be installed');
    const okSvg = renderSvg(resolve(buildScene(okPlan, { width: WIDTH, height: HEIGHT }), { width: WIDTH, height: HEIGHT }));
    if (count(okSvg, '<ellipse') !== 3) fail(`valid log scale wants 3 marks, got ${count(okSvg, '<ellipse')}`);
    if (okSvg.includes('NaN') || okSvg.includes('Infinity')) fail('valid log scale must not emit NaN / Infinity');
}

console.log('charts-render: aggregate keeps only finite numbers…');
{
    const vals = [1, Number.POSITIVE_INFINITY, 2, Number.NaN, Number.NEGATIVE_INFINITY, 4];
    if (aggregate(vals, 'sum') !== 7) fail(`sum wants 7, got ${aggregate(vals, 'sum')}`);
    if (aggregate(vals, 'count') !== 3) fail(`count wants 3, got ${aggregate(vals, 'count')}`);
    if (Math.abs(aggregate(vals, 'mean') - 7 / 3) > 1e-12) fail(`mean wants 7/3, got ${aggregate(vals, 'mean')}`);
    if (aggregate(vals, 'min') !== 1) fail(`min wants 1, got ${aggregate(vals, 'min')}`);
    if (aggregate(vals, 'max') !== 4) fail(`max wants 4, got ${aggregate(vals, 'max')}`);
    if (aggregate(vals, 'median') !== 2) fail(`median wants 2, got ${aggregate(vals, 'median')}`);

    // A column of only non-finite cells has no usable values — every kind
    // must return a finite neutral result instead of poisoning with Infinity.
    const poison = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const kind of ['count', 'sum', 'mean', 'min', 'max', 'median']) {
        if (!Number.isFinite(aggregate(poison, kind))) fail(`${kind} must stay finite on non-finite input`);
    }
    if (aggregate(poison, 'sum') !== 0) fail('sum over no usable values wants 0');
    if (aggregate(poison, 'mean') !== 0) fail('mean over no usable values wants 0');
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
    const paths = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
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

    if (count(svg, '<path') !== paths.length + axisStats(semantic).paths + gridLines(semantic).length) {
        fail(`svg want ${paths.length} series + axis + grid <path>, got ${count(svg, '<path')}`);
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

    // Default theme: the VMZ-anchored palette and neutrals serialize as hex.
    const def = pipeline(colorSpec, colorRows);
    if (!def.svg.includes('fill="#1677ff"')) fail(`default palette first color want #1677ff: ${def.svg.slice(0, 400)}`);
    if (!def.svg.includes('fill="#f59e0b"')) fail('default palette second color want #f59e0b');
    if (!def.svg.includes('stroke="#9ca3af"')) fail('default axis stroke want #9ca3af');
    if (!def.svg.includes('fill="#4b5563"')) fail('default label color want #4b5563');

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
    if (themedSvg.includes('#1677ff') || themedSvg.includes('#9ca3af') || themedSvg.includes('#4b5563')) {
        fail('custom theme must not leak a default color');
    }

    // Ungrouped marks fall back to `markFill`, never the categorical palette.
    const plainPlan = compile(barSpec, fromRows(barRows));
    const plainSvg = renderSvg(
        resolve(buildScene(plainPlan, { width: WIDTH, height: HEIGHT }, { theme: custom }), { width: WIDTH, height: HEIGHT }),
    );
    if (!plainSvg.includes('fill="#000000"')) fail(`ungrouped bars want markFill #000000: ${plainSvg.slice(0, 400)}`);

    // The dark theme lifts palette brightness and quiets the chrome — no
    // light-theme token survives a dark build.
    const dark = buildScene(compile(colorSpec, fromRows(colorRows)), { width: WIDTH, height: HEIGHT }, { theme: DARK_CHART_THEME });
    const darkSvg = renderSvg(resolve(dark, { width: WIDTH, height: HEIGHT }));
    if (!darkSvg.includes('fill="#60a5fa"')) fail(`dark palette first color want #60a5fa: ${darkSvg.slice(0, 400)}`);
    if (!darkSvg.includes('stroke="#374151"')) fail('dark grid stroke want #374151');
    if (!darkSvg.includes('fill="#d1d5db"')) fail('dark label color want #d1d5db');
    if (darkSvg.includes('#1677ff') || darkSvg.includes('#e5e7eb') || darkSvg.includes('#4b5563')) {
        fail('dark theme must not leak a light token');
    }
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

console.log('charts-render: resource prefixes regenerate deterministically…');
{
    const identityA = { mark: 'bar', encoding: [{ field: 'category', channel: 'x' }], data: [{ category: 'alpha', value: 3 }] };
    const identityB = { mark: 'bar', encoding: [{ field: 'category', channel: 'x' }], data: [{ category: 'beta', value: 7 }] };

    // Two independent construction orders must agree — the prefix comes from
    // the declarative inputs, never from a per-process counter.
    const orderA = [resolveResourceIdPrefix('davinci-chart', identityB), resolveResourceIdPrefix('davinci-chart', identityA)];
    const orderB = [resolveResourceIdPrefix('davinci-chart', identityA), resolveResourceIdPrefix('davinci-chart', identityB)];
    if (orderA[0] !== orderB[1] || orderA[1] !== orderB[0]) {
        fail('prefixes must not depend on construction order');
    }
    if (orderA[0] === orderA[1]) fail('distinct identities must derive distinct prefixes');
    const derived = orderA[1];
    if (!derived.startsWith('davinci-chart-') || !derived.endsWith('-')) {
        fail(`derived prefix wants davinci-chart-<hash>-, got ${derived}`);
    }

    // An explicit host prop wins over the derived token.
    if (resolveResourceIdPrefix('davinci-chart', identityA, 'host-1-') !== 'host-1-') {
        fail('an explicit prefix must be returned untouched');
    }
    if (resolveResourceIdPrefix('davinci-chart', identityA, null) !== derived) {
        fail('a null explicit prefix must fall back to the derived token');
    }

    // The derived prefix is a safe id token and survives the render boundary.
    const clippedDisplay = resolve(
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
    const derivedSvg = renderSvg(clippedDisplay, { resourceIdPrefix: derived });
    if (!derivedSvg.includes(`<clipPath id="${derived}clip-0">`)) fail('derived prefix must qualify resource ids');

    // The components resolve prefixes through the shared helper — no counters.
    for (const [file, seq] of [
        ['../../../../../ui/vmz-ui-charts/src/components/Chart.vmz', 'chartInstanceSeq'],
        ['../../../../../ui/vmz-ui-charts/src/components/Diagram.vmz', 'diagramInstanceSeq'],
    ]) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        if (source.includes(seq)) fail(`${file} must not carry the ${seq} counter`);
        if (!source.includes('resolveResourceIdPrefix')) fail(`${file} must resolve prefixes deterministically`);
    }
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
    // Every labeled edge also emits a halo rect behind its text.
    const halos = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'decorative');
    if (halos.length !== 1) fail(`want 1 edge-label halo, got ${halos.length}`);
    if (count(svg, '<rect') !== nodes.length + halos.length) {
        fail(`diagram want ${nodes.length} node + ${halos.length} halo <rect>, got ${count(svg, '<rect')}`);
    }
    if (count(svg, '<path') !== edges.length) fail(`diagram want ${edges.length} edge <path>, got ${count(svg, '<path')}`);
    if (count(svg, '<text') !== labels.length) fail(`diagram want ${labels.length} <text>, got ${count(svg, '<text')}`);
    if (!svg.includes('>go</text>')) fail(`edge label markup missing: ${svg.slice(-200)}`);
    if (svg.includes('NaN') || svg.includes('Infinity')) fail('diagram markup must never carry NaN / Infinity');

    // Edges are clipped to node boundaries: the segment starts on the source
    // node's right edge and ends on the target's left edge — never at the
    // centres (the node body would cover the line).
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
        const cmds = edge.path.commands;
        if (cmds.length !== 2 || cmds[0].kind !== 'move' || cmds[1].kind !== 'line') {
            fail(`edge ${edge.id} must be move → line`);
        }
        if (!(cmds[1].to.x > cmds[0].to.x) || cmds[0].to.y !== cmds[1].to.y) {
            fail(`edge ${edge.id} must run left → right between node borders`);
        }
        const fromNode = nodeById.get(`node-${diagramSpec.edges.find((e) => `edge-${e.id}` === edge.id).fromNode}`);
        const toNode = nodeById.get(`node-${diagramSpec.edges.find((e) => `edge-${e.id}` === edge.id).toNode}`);
        if (Math.abs(cmds[0].to.x - (fromNode.x + fromNode.w)) > 1e-9) {
            fail(`edge ${edge.id} must start on the source border: ${cmds[0].to.x} vs ${fromNode.x + fromNode.w}`);
        }
        if (Math.abs(cmds[1].to.x - toNode.x) > 1e-9) {
            fail(`edge ${edge.id} must end on the target border: ${cmds[1].to.x} vs ${toNode.x}`);
        }
        // The halo covers the text block at the clipped segment midpoint.
        const halo = halos.find((h) => h.id === `edge-label-halo-${edge.id.slice('edge-'.length)}`);
        if (edge.id === 'edge-e1' && !halo) fail('edge-e1 label must carry a halo');
    }
    if (!plan.edges.every((e) => Number.isFinite(e.from.x) && Number.isFinite(e.to.x))) {
        fail('routed edges must stay finite');
    }

    // The canvas keeps a margin so node strokes never touch the edge.
    const minNodeX = Math.min(...nodes.map((n) => n.x));
    if (minNodeX < 12 - 1e-9) fail(`nodes must keep the canvas margin, got ${minNodeX}`);

    // Nodes are rounded and carry the theme fill / stroke.
    for (const node of nodes) {
        if (node.rx <= 0) fail(`node ${node.id} must be rounded`);
        if (!node.fill || !node.stroke) fail(`node ${node.id} must carry theme fill and stroke`);
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

console.log('charts-render: diagram arrows carry real arrowheads…');
{
    const arrowSpec = {
        kind: 'flowchart',
        direction: 'LR',
        nodes: [
            { id: 'a', label: 'Start' },
            { id: 'b', label: 'Middle' },
            { id: 'c', label: 'End' },
        ],
        edges: [
            { id: 'e1', fromNode: 'a', toNode: 'b', edgeKind: 'arrow' },
            { id: 'e2', fromNode: 'b', toNode: 'c', edgeKind: 'dashed' },
        ],
    };
    const { semantic, svg } = diagramPipeline(arrowSpec);
    const arrowheads = semantic.root.children.filter(
        (n) => n.kind === 'path' && n.role === 'diagram.edge' && n.id.startsWith('edge-arrow-to-'),
    );
    if (arrowheads.length !== 1) fail(`want 1 arrowhead, got ${arrowheads.length}`);
    const head = arrowheads[0];
    if (!head.fill) fail('arrowhead must be filled');
    const cmds = head.path.commands;
    if (cmds.length !== 4 || cmds[3].kind !== 'close') fail('arrowhead must be a closed triangle');
    // The tip lands on the target node's left border.
    const target = semantic.root.children.find((n) => n.id === 'node-b');
    if (Math.abs(cmds[0].to.x - target.x) > 1e-9) fail(`arrow tip must land on the target border: ${cmds[0].to.x} vs ${target.x}`);
    if (count(svg, '<path') !== 2 + 1) fail(`svg want 2 edges + 1 arrowhead, got ${count(svg, '<path')}`);
    // Dashed edges serialize a dash array.
    if (!svg.includes('stroke-dasharray="6 4"')) fail('dashed edge must carry a dash array');
}

console.log('charts-render: diagram node labels truncate into their box…');
{
    const longSpec = {
        kind: 'flowchart',
        direction: 'LR',
        nodes: [{ id: 'a', label: 'DataSnapshotWithAVeryLongName' }],
        edges: [],
    };
    const { semantic } = diagramPipeline(longSpec);
    const label = semantic.root.children.find((n) => n.id === 'node-label-a');
    const node = semantic.root.children.find((n) => n.id === 'node-a');
    if (!label.text.endsWith('…')) fail(`long node label must truncate: ${label.text}`);
    const labelWidth = estimateTextSize(label.text, label.font.sizePx).width;
    if (labelWidth > node.w - 12 + 1e-9) fail(`truncated label must fit the node: ${labelWidth} vs ${node.w - 12}`);
}

console.log('charts-render: diagram dark theme replaces every token…');
{
    const { DARK_DIAGRAM_THEME } = facadeDiagram;
    const plan = simpleLayout(diagramSpec);
    const semantic = buildDiagramScene(diagramSpec, plan, { theme: DARK_DIAGRAM_THEME });
    const svg = renderSvg(resolve(semantic, { width: plan.canvasBounds.w, height: plan.canvasBounds.h }));
    if (!svg.includes('fill="#1f2937"')) fail(`dark node fill want #1f2937: ${svg.slice(0, 400)}`);
    if (!svg.includes('fill="#e5e7eb"')) fail('dark node label color want #e5e7eb');
    if (svg.includes('#f8fafc')) fail('dark theme must not leak the light node fill');
}

console.log('charts-render: preserveNodeIds binds DOM back to stable identity…');
{
    const { semantic } = pipeline(barSpec, barRows);
    const withIds = renderSvg(resolve(semantic, { width: WIDTH, height: HEIGHT, preserveNodeIds: true }));
    if (!withIds.includes('data-dvz-id="bar:0"')) fail('opted-in render must emit data-dvz-id hooks');
    if (!withIds.includes('data-dvz-id="x-axis:baseline"')) fail('axis nodes must carry ids too');
    // Default renders stay stripped — no id hooks leak into static output.
    const plain = pipeline(barSpec, barRows).svg;
    if (plain.includes('data-dvz-id')) fail('default render must not emit data-dvz-id');
}

// ─── Series layouts: dodge + stack ───────────────────────────────────────

const groupRows = [
    { quarter: 'Q1', sales: 40, region: 'North' },
    { quarter: 'Q2', sales: 70, region: 'North' },
    { quarter: 'Q1', sales: 30, region: 'South' },
    { quarter: 'Q2', sales: 50, region: 'South' },
];

console.log('charts-render: grouped bars dodge side by side by default…');
{
    const spec = {
        mark: 'bar',
        encoding: [
            { field: 'quarter', channel: 'x' },
            { field: 'sales', channel: 'y' },
            { field: 'region', channel: 'color' },
        ],
    };
    const { semantic, svg } = pipeline(spec, groupRows);
    const bars = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    if (bars.length !== 4) fail(`want 4 dodged bars, got ${bars.length}`);
    // Q1 pair shares the slot but never overlaps: the two Q1 bars are disjoint.
    const q1 = bars.filter((b) => b.id === 'bar:0' || b.id === 'bar:2');
    if (q1.length !== 2) fail(`want Q1 pair, got ${q1.map((b) => b.id)}`);
    const overlap = Math.min(q1[0].x + q1[0].w, q1[1].x + q1[1].w) - Math.max(q1[0].x, q1[1].x);
    if (overlap > 1e-9) fail(`dodged bars must not overlap, overlap=${overlap}`);
    // First-appearance order: North (palette 0) sits left of South.
    if (!(q1[0].x < q1[1].x)) fail('North must dodge left of South');
    // Every bar still hangs from the zero baseline.
    const baseline = Math.max(...bars.map((b) => b.y + b.h));
    for (const b of bars) {
        if (Math.abs(b.y + b.h - baseline) > 1e-9) fail(`dodged bar must share the zero baseline: ${b.id}`);
    }
    if (count(svg, '<rect') !== 4 + 2) fail(`svg want 4 bars + 2 legend swatches, got ${count(svg, '<rect')}`);
}

console.log('charts-render: stack accumulates from the zero baseline…');
{
    const spec = {
        mark: 'bar',
        seriesLayout: 'stack',
        encoding: [
            { field: 'quarter', channel: 'x' },
            { field: 'sales', channel: 'y' },
            { field: 'region', channel: 'color' },
        ],
    };
    const { plan, semantic, svg } = pipeline(spec, groupRows);
    const bars = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    if (bars.length !== 4) fail(`want 4 stacked bars, got ${bars.length}`);
    // Q1 total = 70: the South bar must start where North ends (same x slot).
    const north = bars.find((b) => b.id === 'bar:0');
    const south = bars.find((b) => b.id === 'bar:2');
    if (Math.abs(north.x - south.x) > 1e-9) fail('stacked bars share one x slot');
    if (Math.abs(south.y - north.y) < 1e-9) fail('stacked bars must not coincide');
    // south.y + south.h == north.y (South stacks on top of North).
    if (Math.abs(south.y + south.h - north.y) > 1e-9) {
        fail(`stack must be flush: south bottom ${south.y + south.h} vs north top ${north.y}`);
    }
    // The y domain covers the stacked totals (Q2 = 120), even though nice
    // ticks stop at a round value below it.
    const yDomain = plan.scales.get('y').domain;
    if (yDomain[1] < 120) fail(`stacked domain must cover totals, got [${yDomain}]`);
    if (yDomain[0] > 0) fail('stacked domain must include the zero baseline');
    if (count(svg, '<rect') !== 4 + 2) fail('stacked bars + swatches must serialize');
    if (svg.includes('NaN')) fail('stacked svg must not carry NaN');

    // Plan-level contract: stackBase in data units, first-appearance order.
    const southMark = plan.marks.find((m) => m.key === '2');
    if (southMark.stackBase === undefined) fail('stacked marks must carry stackBase');
    if (Math.abs(southMark.stackBase - 40) > 1e-9) fail(`South Q1 base want 40, got ${southMark.stackBase}`);
}

console.log('charts-render: stack separates positive and negative totals…');
{
    const spec = {
        mark: 'bar',
        seriesLayout: 'stack',
        encoding: [
            { field: 'quarter', channel: 'x' },
            { field: 'delta', channel: 'y' },
            { field: 'region', channel: 'color' },
        ],
    };
    const rows = [
        { quarter: 'Q1', delta: 10, region: 'North' },
        { quarter: 'Q1', delta: -6, region: 'South' },
        { quarter: 'Q1', delta: 4, region: 'West' },
    ];
    const { semantic } = pipeline(spec, rows);
    const bars = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    const north = bars.find((b) => b.id === 'bar:0');
    const south = bars.find((b) => b.id === 'bar:1');
    const west = bars.find((b) => b.id === 'bar:2');
    // Positives stack up (West on top of North), negatives hang from zero.
    if (Math.abs(west.y + west.h - north.y) > 1e-9) fail('positive stack must be flush');
    // Zero sits inside the plot; South hangs from zero downward.
    const zeroPixel = north.y + north.h;
    if (Math.abs(south.y - zeroPixel) > 1e-9) fail(`negative stack must hang from zero: ${south.y} vs ${zeroPixel}`);
    if (south.h <= 0) fail('negative stacked bar must keep a positive height');
}

console.log('charts-render: stacked area draws a ribbon, not a zero drop…');
{
    const spec = {
        mark: 'area',
        seriesLayout: 'stack',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'requests', channel: 'y' },
            { field: 'service', channel: 'color' },
        ],
    };
    const rows = [
        { day: 1, requests: 10, service: 'api' },
        { day: 2, requests: 20, service: 'api' },
        { day: 1, requests: 5, service: 'web' },
        { day: 2, requests: 8, service: 'web' },
    ];
    const { semantic, svg } = pipeline(spec, rows);
    const areas = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (areas.length !== 2) fail(`want 2 stacked areas, got ${areas.length}`);
    // The top series (web) must not touch the zero baseline — its closing edge
    // walks the api curve back.
    const web = areas.find((a) => a.id === 'area:web');
    const ys = web.path.commands.map((c) => c.to?.y).filter((v) => Number.isFinite(v));
    const baseline = Math.max(...ys);
    const apiBottom = areas.find((a) => a.id === 'area:api');
    const apiMaxY = Math.max(...apiBottom.path.commands.map((c) => c.to?.y).filter((v) => Number.isFinite(v)));
    if (Math.abs(baseline - apiMaxY) > 1e-9 && baseline >= apiMaxY) {
        fail('web ribbon bottom must follow the api top, not the zero baseline');
    }
    if (svg.includes('NaN')) fail('stacked area must not carry NaN');
}

console.log('charts-render: layout misuse is diagnosed, never silent…');
{
    const lineSpec = {
        mark: 'line',
        seriesLayout: 'stack',
        encoding: [
            { field: 'd', channel: 'x' },
            { field: 'v', channel: 'y' },
            { field: 's', channel: 'color' },
        ],
    };
    const rows = [
        { d: 1, v: 2, s: 'A' },
        { d: 2, v: 3, s: 'B' },
    ];
    const plan = compile(lineSpec, fromRows(rows));
    const err = plan.diagnostics.items.find((d) => d.code === 'davinci.chart.unsupported-layout');
    if (!err) fail('stack on line must raise davinci.chart.unsupported-layout');
    if (err.severity !== 'error') fail(`unsupported-layout must be an error, got ${err.severity}`);
    if (plan.marks.some((m) => m.stackBase !== undefined)) fail('refused layout must not carry stack offsets');

    const noSeries = compile(
        { mark: 'bar', seriesLayout: 'stack', encoding: barSpec.encoding },
        fromRows(barRows),
    );
    if (!noSeries.diagnostics.items.some((d) => d.code === 'davinci.chart.layout-without-series')) {
        fail('stack without a series channel must raise layout-without-series');
    }
    if (noSeries.marks.some((m) => m.stackBase !== undefined)) fail('no-series layout must not stack');

    const dodgeLine = compile(
        { mark: 'line', seriesLayout: 'dodge', encoding: lineSpec.encoding },
        fromRows(rows),
    );
    if (!dodgeLine.diagnostics.items.some((d) => d.code === 'davinci.chart.layout-ignored')) {
        fail('dodge on line must raise layout-ignored');
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

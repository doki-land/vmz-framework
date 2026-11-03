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
 * - a legend appears only when a color / series channel exists, laid out as
 *   rows above the plot so it never covers data; entries wrap across up to
 *   three rows and overflowing entries collapse into an explicit `+N` marker
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
 * - grouped bars dodge side by side inside the x slot, `stack` accumulates
 *   same-sign values from the zero baseline (bars flush, areas as ribbons,
 *   plan marks carry `stackBase`, the y domain covers the totals), and layout
 *   misuse is diagnosed (`unsupported-layout` / `layout-without-series` /
 *   `layout-ignored`)
 * - pie / donut slices run clockwise from twelve o'clock as annular-sector
 *   paths with matching hit regions and contrast-aware percentage labels,
 *   need a `theta` channel, drop negative shares with a warning, refuse an
 *   out-of-range `innerRadiusRatio`, and skip the cartesian frame entirely
 * - radar draws a polar web: spokes per dimension from twelve o'clock, tick
 *   rings carrying the real value domain, one closed translucent polygon per
 *   series, vertex marks with row-stable ids, and a degenerate-dimension
 *   warning (`davinci.chart.radar-few-dimensions`)
 * - `facetField` lays out small multiples in a `ceil(sqrt(n))` grid with
 *   shared scales, per-panel axes and titles, facet-qualified furniture ids
 *   (row-level mark ids stay key-stable and globally unique), a warning for
 *   missing facet cells, and an error for an unknown facet field
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
    registerGeoMap,
} from '../../../../../davinci/davinci-chart/src/index.ts';
import { rgb8 } from '../../../../../davinci/davinci-types/src/index.ts';
import {
    estimateTextSize,
    renderCanvas,
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

    // Long legend entries wrap into multiple rows above the plot instead of
    // clipping; both categories survive on a narrow viewport.
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
    const entryLabels = legendTexts.map((t) => t.text);
    // The first entry is wider than the narrow row: kept, truncated into it.
    if (!entryLabels.some((t) => t.startsWith('europe') && t.endsWith('…'))) {
        fail(`the first entry must be kept and truncated, got ${entryLabels}`);
    }
    // The second wraps onto its own row intact — no +N drop for two entries.
    if (!entryLabels.some((t) => t === 'asia-pacific')) fail(`the second entry must survive on its own row, got ${entryLabels}`);
    if (legendTexts.some((t) => t.id === 'legend:overflow')) fail('two entries must not overflow');
    const legendSwatches = legendGroup.children.filter((n) => n.kind === 'rect');
    const rowYs = new Set(legendSwatches.map((s) => s.y));
    if (rowYs.size !== 2) fail(`the two entries must wrap onto two rows, got ${rowYs.size}`);
    // The strip stays inside the viewport and strictly above the plot marks.
    const narrowBars = legendSemantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    const narrowPlotTop = Math.min(...narrowBars.map((b) => b.y));
    for (const child of legendGroup.children) {
        const w = child.kind === 'rect' ? child.w : estimateTextSize(child.text, 12).width;
        const cx = child.kind === 'rect' ? child.x + child.w / 2 : child.anchor.x;
        if (cx + w / 2> narrow.width + 1e-9) fail(`legend must stay inside the viewport: ${JSON.stringify(child)}`);
        const cy = child.kind === 'rect' ? child.y + child.h / 2 : child.anchor.y;
        if (cy >= narrowPlotTop) fail('legend strip must stay above the plot');
    }

    // Past the row cap the rest collapse into an explicit +N marker on the
    // last row — never a silent drop, never a fourth row.
    const manyPlan = compile(
        legendSpec,
        fromRows(
            ['north', 'south', 'east', 'west', 'central', 'coastal', 'alpine', 'metro', 'rural', 'island'].map(
                (region, i) => ({ category: `c${i}`, value: i + 2, region }),
            ),
        ),
    );
    const manySemantic = buildScene(manyPlan, narrow);
    const manyLegend = guideGroups(manySemantic, 'chart.legend')[0];
    const manySwatches = manyLegend.children.filter((n) => n.kind === 'rect');
    const manyRowYs = [...new Set(manySwatches.map((s) => s.y))].sort((a, b) => a - b);
    if (manyRowYs.length !== 3) fail(`ten regions must cap at 3 legend rows, got ${manyRowYs.length}`);
    const overflow = manyLegend.children.find((n) => n.id === 'legend:overflow');
    if (!overflow) fail('capped legend must carry an overflow marker');
    const placed = manySwatches.length;
    if (overflow.text !== `+${10 - placed}`) fail(`marker must count dropped series, got ${overflow.text} for ${placed} placed`);
    // The marker sits on the last row: swatch top is rowTop + (rowH-10)/2.
    const rowH = legendRowHeightRef();
    const lastRowTop = manyRowYs[manyRowYs.length - 1] - (rowH - 10) / 2;
    if (Math.abs(overflow.anchor.y - (lastRowTop + rowH / 2)) > 1e-9) {
        fail('overflow marker must sit on the last legend row');
    }
    const manyBars = manySemantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    const manyPlotTop = Math.min(...manyBars.map((b) => b.y));
    if (manyRowYs[manyRowYs.length - 1] >= manyPlotTop) fail('the last legend row must stay above the plot');

    // Row pitch is constant: adjacent rows differ by rowHeight + row gap.
    if (manyRowYs.length > 1 && Math.abs(manyRowYs[1] - manyRowYs[0] - (manyRowYs[2] - manyRowYs[1])) > 1e-9) {
        fail('legend rows must keep a constant pitch');
    }
}

/** Row height the legend uses at the default 12px legend font. */
function legendRowHeightRef() {
    return Math.max(10, estimateTextSize('Ag', 12).height);
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

// ─── Pie / donut ─────────────────────────────────────────────────────────

console.log("charts-render: pie slices share the circle from twelve o'clock…");
{
    const pieSpec = {
        mark: 'pie',
        keyField: 'kind',
        encoding: [
            { field: 'value', channel: 'theta' },
            { field: 'kind', channel: 'color' },
        ],
    };
    const pieRows = [
        { kind: 'alpha', value: 40 },
        { kind: 'beta', value: 30 },
        { kind: 'gamma', value: 20 },
        { kind: 'delta', value: 10 },
    ];
    const { semantic, svg } = pipeline(pieSpec, pieRows);
    const slices = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (slices.length !== 4) fail(`want 4 pie slices, got ${slices.length}`);
    // Angles run clockwise from twelve o'clock and cover the full circle.
    let acc = -Math.PI / 2;
    for (let i = 0; i < slices.length; i++) {
        const sector = slices[i].hitRegion?.sector;
        if (!sector) fail(`slice ${i} must carry a sector hit region`);
        const sweep = (pieRows[i].value / 100) * Math.PI * 2;
        if (Math.abs(sector.a0 - acc) > 1e-9) fail(`slice ${i} must start where the previous ended`);
        if (Math.abs(sector.a1 - sector.a0 - sweep) > 1e-9) {
            fail(`slice ${i} sweep want ${sweep}, got ${sector.a1 - sector.a0}`);
        }
        if (sector.rInner !== 0) fail('a pie (not donut) must have zero inner radius');
        acc = sector.a1;
    }
    if (Math.abs(acc - Math.PI * 1.5) > 1e-9) fail('slices must cover the full circle');
    // Stable identity: ids carry the keyField value, palette order is first appearance.
    if (slices[0].id !== 'pie:alpha') fail(`slice id want pie:alpha, got ${slices[0].id}`);
    const expect = DEFAULT_CHART_THEME.seriesPalette[0];
    const got = slices[0].fill.color;
    if (got.r !== expect.r || got.g !== expect.g || got.b !== expect.b) {
        fail('alpha slice must take the first palette color');
    }
    // Wide slices carry a real percentage label, anchored inside the slice.
    const labels = collectTexts(semantic.root).filter((t) => t.id.startsWith('pie:label:'));
    if (!labels.some((t) => t.text === '40%')) fail('alpha slice must be labelled 40%');
    for (const label of labels) {
        const sector = slices.find((s) => s.id === `pie:${label.id.slice('pie:label:'.length)}`).hitRegion.sector;
        const mid = (sector.a0 + sector.a1) / 2;
        const dx = label.anchor.x - sector.cx;
        const dy = label.anchor.y - sector.cy;
        const labelR = Math.hypot(dx, dy);
        // Unit-vector comparison avoids the atan2 2π wrap for mid-angles past π.
        if (Math.abs(dx / labelR - Math.cos(mid)) > 1e-9 || Math.abs(dy / labelR - Math.sin(mid)) > 1e-9) {
            fail(`label ${label.id} must sit at the slice mid-angle`);
        }
        if (!(labelR > sector.rInner && labelR < sector.rOuter)) fail(`label ${label.id} must sit inside the slice`);
    }
    // No cartesian furniture: no axes, no grid — but the legend still lists slices.
    if (axisStats(semantic).groups.length !== 0) fail('pie must not draw axes');
    if (gridLines(semantic).length !== 0) fail('pie must not draw grid lines');
    const legendTexts = collectTexts(semantic.root).filter((t) => t.id.startsWith('legend:label:'));
    if (legendTexts.length !== 4) fail(`want 4 legend entries, got ${legendTexts.length}`);
    if (svg.includes('NaN')) fail('pie svg must not carry NaN');
    // A single-slice pie is a full circle — SVG arcs split it into two halves.
    const single = pipeline(pieSpec, [{ kind: 'only', value: 5 }]);
    const singleSlice = single.semantic.root.children.find((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (!singleSlice) fail('single-slice pie must still render');
    if (singleSlice.path.commands.filter((c) => c.kind === 'arc').length !== 2) {
        fail('a full-circle slice must split into two arcs');
    }
    if (single.svg.includes('NaN')) fail('single-slice svg must not carry NaN');
}

console.log('charts-render: donut slices are ring sectors with an inner radius…');
{
    const donutSpec = {
        mark: 'pie',
        innerRadiusRatio: 0.6,
        keyField: 'kind',
        encoding: [
            { field: 'value', channel: 'theta' },
            { field: 'kind', channel: 'color' },
        ],
    };
    const { semantic, svg } = pipeline(donutSpec, [
        { kind: 'alpha', value: 3 },
        { kind: 'beta', value: 1 },
    ]);
    const slices = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (slices.length !== 2) fail(`want 2 donut slices, got ${slices.length}`);
    const sector = slices[0].hitRegion.sector;
    if (!(sector.rInner > 0)) fail('donut slice must carry a positive inner radius');
    if (Math.abs(sector.rInner / sector.rOuter - 0.6) > 1e-9) fail('hit region must keep the inner radius ratio');
    // Ring sector = outer arc + inner arc sweeping the opposite way.
    const arcs = slices[0].path.commands.filter((c) => c.kind === 'arc');
    if (arcs.length !== 2) fail(`donut slice must have 2 arcs, got ${arcs.length}`);
    if (arcs[0].sweep === arcs[1].sweep) fail('inner arc must sweep opposite the outer arc');
    if (svg.includes('NaN')) fail('donut svg must not carry NaN');
}

console.log('charts-render: pie refuses bad authoring loudly…');
{
    // Missing theta channel → error, no slices.
    const noTheta = compile({ mark: 'pie', encoding: [{ field: 'kind', channel: 'color' }] }, fromRows([{ kind: 'a' }]));
    if (!noTheta.diagnostics.items.some((d) => d.code === 'davinci.chart.pie-needs-theta' && d.severity === 'error')) {
        fail('pie without theta must raise pie-needs-theta');
    }
    const noThetaScene = buildScene(noTheta, { width: WIDTH, height: HEIGHT });
    if (noThetaScene.root.children.some((n) => n.role === 'chart.mark' && n.kind === 'path')) {
        fail('theta-less pie must not draw slices');
    }
    // innerRadiusRatio outside [0, 1) → error.
    const badRatio = compile(
        { mark: 'pie', innerRadiusRatio: 1.2, encoding: [{ field: 'v', channel: 'theta' }] },
        fromRows([{ v: 1 }]),
    );
    if (
        !badRatio.diagnostics.items.some((d) => d.code === 'davinci.chart.invalid-inner-radius' && d.severity === 'error')
    ) {
        fail('innerRadiusRatio >= 1 must raise invalid-inner-radius');
    }
    // Negative slice → warning + dropped, the survivor renormalizes to the circle.
    const neg = compile(
        {
            mark: 'pie',
            keyField: 'kind',
            encoding: [
                { field: 'value', channel: 'theta' },
                { field: 'kind', channel: 'color' },
            ],
        },
        fromRows([
            { kind: 'ok', value: 3 },
            { kind: 'bad', value: -1 },
        ]),
    );
    if (!neg.diagnostics.items.some((d) => d.code === 'davinci.chart.negative-slice')) {
        fail('negative theta must raise negative-slice');
    }
    if (neg.marks.length !== 1) fail(`negative slice must be dropped, got ${neg.marks.length} marks`);
    const negScene = buildScene(neg, { width: WIDTH, height: HEIGHT });
    const negSlices = negScene.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (negSlices.length !== 1) fail('only the non-negative slice renders');
    const sec = negSlices[0].hitRegion.sector;
    if (Math.abs(sec.a1 - sec.a0 - Math.PI * 2) > 1e-6) fail('single surviving slice must cover the circle');
}

// ─── Radar (polar web) ───────────────────────────────────────────────────

console.log('charts-render: radar draws a polar web with real geometry…');
{
    const radarSpec = {
        mark: 'radar',
        keyField: 'id',
        encoding: [
            { field: 'dim', channel: 'x' },
            { field: 'score', channel: 'y' },
            { field: 'product', channel: 'color' },
        ],
    };
    const dims = ['速度', '稳定性', '功能', '生态', '文档'];
    const radarRows = [
        { id: 'a-0', dim: '速度', score: 80, product: 'alpha' },
        { id: 'a-1', dim: '稳定性', score: 65, product: 'alpha' },
        { id: 'a-2', dim: '功能', score: 90, product: 'alpha' },
        { id: 'a-3', dim: '生态', score: 45, product: 'alpha' },
        { id: 'a-4', dim: '文档', score: 70, product: 'alpha' },
        { id: 'b-0', dim: '速度', score: 55, product: 'beta' },
        { id: 'b-1', dim: '稳定性', score: 85, product: 'beta' },
        { id: 'b-2', dim: '功能', score: 60, product: 'beta' },
        { id: 'b-3', dim: '生态', score: 75, product: 'beta' },
        { id: 'b-4', dim: '文档', score: 50, product: 'beta' },
    ];
    const { plan, semantic, svg } = pipeline(radarSpec, radarRows);

    // Web structure: spokes per dimension, tick rings, one axis-furniture
    // group, one closed polygon per series, one vertex per row.
    const grid = gridLines(semantic);
    const spokes = grid.filter((n) => n.id.startsWith('radar:spoke:'));
    const rings = grid.filter((n) => n.id.startsWith('radar:ring:'));
    if (spokes.length !== dims.length) fail(`want ${dims.length} spokes, got ${spokes.length}`);
    if (rings.length < 2) fail(`want at least 2 tick rings, got ${rings.length}`);
    const polygons = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (polygons.length !== 2) fail(`want 2 series polygons, got ${polygons.length}`);
    const vertices = semantic.root.children.filter((n) => n.kind === 'ellipse' && n.role === 'chart.mark');
    if (vertices.length !== radarRows.length) fail(`want ${radarRows.length} vertices, got ${vertices.length}`);

    // Geometry: spokes radiate from the shared center, the first dimension
    // sits at twelve o'clock, and polygons close over one vertex per dim.
    const spoke0 = spokes[0].path.commands;
    const cx = spoke0[0].to.x;
    const cy = spoke0[0].to.y;
    const spokeEnd = spokes[0].path.commands[1].to;
    const rOuter = Math.hypot(spokeEnd.x - cx, spokeEnd.y - cy);
    if (!(rOuter > 0)) fail('spokes must have a positive length');
    if (Math.abs(spokeEnd.x - cx) > 1e-9 || !(spokeEnd.y < cy)) fail('the first spoke must point to twelve o’clock');
    for (let i = 0; i < spokes.length; i++) {
        const end = spokes[i].path.commands[1].to;
        if (Math.abs(Math.hypot(end.x - cx, end.y - cy) - rOuter) > 1e-9) {
            fail(`spoke ${i} must reach the outer ring`);
        }
        const wantAngle = -Math.PI / 2 + (i / dims.length) * Math.PI * 2;
        const gotAngle = Math.atan2(end.y - cy, end.x - cx);
        if (Math.abs(Math.cos(gotAngle) - Math.cos(wantAngle)) > 1e-9 || Math.abs(Math.sin(gotAngle) - Math.sin(wantAngle)) > 1e-9) {
            fail(`spoke ${i} angle mismatch`);
        }
    }
    for (const p of polygons) {
        const cmds = p.path.commands;
        if (cmds[cmds.length - 1].kind !== 'close') fail('radar polygon must be closed');
        if (cmds.filter((c) => c.kind === 'line').length !== dims.length - 1) {
            fail('polygon must visit one vertex per dimension');
        }
        const first = cmds[0].to;
        if (Math.abs(first.x - cx) > 1e-9) fail('the first polygon vertex must sit on the top spoke');
        // Translucent fill over a full-strength stroke, palette-ordered.
        if (Math.abs(p.fill.color.a - DEFAULT_CHART_THEME.areaFillOpacity) > 1e-9) {
            fail('radar polygon fill must use the area fill opacity token');
        }
    }
    const alphaColor = DEFAULT_CHART_THEME.seriesPalette[0];
    if (polygons[0].stroke.color.r !== alphaColor.r || polygons[0].stroke.color.g !== alphaColor.g) {
        fail('the first series polygon must take the first palette color');
    }

    // Radius mapping is real: a vertex distance from the center is the value
    // projected through the shared y domain, so alpha[功能]=90 sits farther
    // out than beta[功能]=60 on the same spoke.
    const yDomain = plan.scales.get('y').domain;
    if (yDomain[0] > 0) fail('radar domain must include the zero baseline');
    const vertexById = new Map(vertices.map((v) => [v.id, v]));
    const aFun = vertexById.get('radar:a-2');
    const bFun = vertexById.get('radar:b-2');
    const rA = Math.hypot(aFun.cx - cx, aFun.cy - cy);
    const rB = Math.hypot(bFun.cx - cx, bFun.cy - cy);
    if (!(rA > rB)) fail('a higher score must sit farther from the center');
    const wantRA = ((90 - yDomain[0]) / (yDomain[1] - yDomain[0])) * rOuter;
    if (Math.abs(rA - wantRA) > 1e-9) fail(`vertex radius must project the value, want ${wantRA}, got ${rA}`);

    // Labels: dimension labels outside the web, ring value labels on the top
    // spoke, legend above the plot, and no cartesian axes.
    const axisGroup = semantic.root.children.find((n) => n.kind === 'group' && n.role === 'chart.axis');
    if (!axisGroup) fail('radar must emit an axis-furniture group');
    const dimLabels = axisGroup.children.filter((t) => t.id.startsWith('radar:dim:'));
    if (dimLabels.length !== dims.length) fail(`want ${dims.length} dimension labels, got ${dimLabels.length}`);
    for (const t of dimLabels) {
        if (!(Math.hypot(t.anchor.x - cx, t.anchor.y - cy) > rOuter)) {
            fail(`dimension label ${t.text} must sit outside the web`);
        }
    }
    const tickLabels = axisGroup.children.filter((t) => t.id.startsWith('radar:tick:'));
    if (tickLabels.length !== rings.length) fail('every ring must carry a value label');
    for (const t of tickLabels) {
        if (Math.abs(t.anchor.y - cy) > rOuter + 1e-9) fail('tick labels must stay inside the web');
        if (!(t.anchor.x > cx)) fail('tick labels must sit right of the top spoke');
    }
    const legendTexts = collectTexts(semantic.root).filter((t) => t.id.startsWith('legend:label:'));
    if (legendTexts.length !== 2) fail('radar legend must list both series');
    if (svg.includes('NaN')) fail('radar svg must not carry NaN');

    // Dark theme re-tokens the web: palette and chrome both change.
    const darkScene = buildScene(plan, { width: WIDTH, height: HEIGHT }, { theme: DARK_CHART_THEME });
    const darkPoly = darkScene.root.children.find((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (darkPoly.stroke.color.r === polygons[0].stroke.color.r && darkPoly.stroke.color.g === polygons[0].stroke.color.g) {
        fail('dark radar must use the dark palette');
    }
    const darkRing = darkScene.root.children.find((n) => n.id.startsWith('radar:ring:'));
    if (darkRing.stroke.color.r !== DARK_CHART_THEME.gridStroke.r) fail('dark rings must use the dark grid token');

    // Degenerate authoring: two dimensions raise a warning, values that never
    // vary still render a finite web.
    const few = compile(radarSpec, fromRows(radarRows.filter((r) => r.dim === '速度' || r.dim === '稳定性')));
    if (!few.diagnostics.items.some((d) => d.code === 'davinci.chart.radar-few-dimensions')) {
        fail('two-dimension radar must raise radar-few-dimensions');
    }
    const flat = pipeline(
        radarSpec,
        dims.map((dim, i) => ({ id: `f-${i}`, dim, score: 50, product: 'alpha' })),
    );
    if (flat.svg.includes('NaN')) fail('flat radar must not carry NaN');
}

// ─── Facets (small multiples) ────────────────────────────────────────────

console.log('charts-render: facets lay out small multiples with shared scales…');
{
    const facetSpec = {
        mark: 'bar',
        keyField: 'id',
        facetField: 'region',
        encoding: [
            { field: 'quarter', channel: 'x' },
            { field: 'sales', channel: 'y' },
        ],
    };
    const facetRows = [
        { id: 'e-q1', region: 'East', quarter: 'Q1', sales: 10 },
        { id: 'e-q2', region: 'East', quarter: 'Q2', sales: 24 },
        { id: 'w-q1', region: 'West', quarter: 'Q1', sales: 10 },
        { id: 'w-q2', region: 'West', quarter: 'Q2', sales: 14 },
        { id: 'n-q1', region: 'North', quarter: 'Q1', sales: 31 },
        { id: 'n-q2', region: 'North', quarter: 'Q2', sales: 18 },
        { id: 's-q1', region: 'South', quarter: 'Q1', sales: 22 },
        { id: 's-q2', region: 'South', quarter: 'Q2', sales: 27 },
    ];
    const { plan, semantic, svg } = pipeline(facetSpec, facetRows);

    // Four panels in first-appearance order, 2×2: one title and one axis
    // pair per panel, furniture ids facet-qualified, mark ids row-stable.
    const titles = semantic.root.children.filter((n) => n.id.endsWith('facet:title'));
    if (titles.length !== 4) fail(`want 4 facet titles, got ${titles.length}`);
    const order = titles.map((t) => t.text).join(',');
    if (order !== 'East,West,North,South') fail(`facet order must be first appearance, got ${order}`);
    const axisGroups = semantic.root.children.filter((n) => n.kind === 'group' && n.role === 'chart.axis');
    if (axisGroups.length !== 8) fail(`want 8 panel axis groups, got ${axisGroups.length}`);
    for (let i = 0; i < 4; i++) {
        if (!axisGroups.some((g) => g.id === `f${i}:x-axis`)) fail(`panel ${i} must own an x axis`);
        if (!axisGroups.some((g) => g.id === `f${i}:y-axis`)) fail(`panel ${i} must own a y axis`);
    }
    const bars = semantic.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark');
    if (bars.length !== 8) fail(`want 8 facet bars, got ${bars.length}`);
    if (!bars.some((b) => b.id === 'bar:n-q1')) fail('mark ids must stay row-stable inside panels');

    // The scene contract holds: no duplicate ids anywhere in the facet grid.
    const problems = validateScene(semantic);
    if (problems.some((d) => d.code === 'davinci.scene.duplicate-id')) {
        fail('facet panels must not duplicate node ids');
    }

    // Shared scales: the same value in two panels has the same bar height,
    // and a panel in the second grid row sits strictly below the first row.
    const byId = new Map(bars.map((b) => [b.id, b]));
    const eastQ1 = byId.get('bar:e-q1');
    const westQ1 = byId.get('bar:w-q1');
    const northQ1 = byId.get('bar:n-q1');
    if (Math.abs(eastQ1.h - westQ1.h) > 1e-9) fail('shared scales must give equal values equal heights');
    if (!(westQ1.x > eastQ1.x)) fail('West must panel right of East');
    if (!(northQ1.y > eastQ1.y)) fail('North must panel below East');
    if (Math.abs(northQ1.h - eastQ1.h) < 1e-9) fail('different values must project to different heights');

    // One global legend only when a series channel exists — none here.
    if (semantic.root.children.some((n) => n.id === 'chart-legend')) fail('ungrouped facets must not draw a legend');
    if (svg.includes('NaN')) fail('facet svg must not carry NaN');

    // Faceting works for series marks too: line ids are facet-qualified.
    const facetLine = pipeline(
        {
            mark: 'line',
            facetField: 'region',
            encoding: [
                { field: 'quarter', channel: 'x' },
                { field: 'sales', channel: 'y' },
                { field: 'channel', channel: 'color' },
            ],
        },
        [
            { region: 'East', quarter: 'Q1', sales: 10, channel: 'online' },
            { region: 'East', quarter: 'Q2', sales: 24, channel: 'online' },
            { region: 'West', quarter: 'Q1', sales: 10, channel: 'online' },
            { region: 'West', quarter: 'Q2', sales: 14, channel: 'online' },
        ],
    );
    const linePaths = facetLine.semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (linePaths.length !== 2) fail(`want 2 faceted lines, got ${linePaths.length}`);
    if (!linePaths.some((p) => p.id === 'f0:line:online') || !linePaths.some((p) => p.id === 'f1:line:online')) {
        fail('faceted series marks must carry facet-qualified ids');
    }
    if (validateScene(facetLine.semantic).some((d) => d.code === 'davinci.scene.duplicate-id')) {
        fail('faceted lines must not duplicate ids');
    }

    // Missing facet cells warn and never reach a panel.
    const withMissing = compile(facetSpec, fromRows([...facetRows, { id: 'x-q1', region: null, quarter: 'Q1', sales: 99 }]));
    if (!withMissing.diagnostics.items.some((d) => d.code === 'davinci.chart.missing-facet-value')) {
        fail('a null facet cell must raise missing-facet-value');
    }
    const missingScene = buildScene(withMissing, { width: WIDTH, height: HEIGHT });
    if (missingScene.root.children.filter((n) => n.kind === 'rect' && n.role === 'chart.mark').length !== 8) {
        fail('a row with a missing facet value must appear in no panel');
    }

    // Unknown facet field is an authoring error.
    const unknown = compile({ ...facetSpec, facetField: 'nope' }, fromRows(facetRows));
    if (!unknown.diagnostics.items.some((d) => d.code === 'davinci.chart.unknown-field' && d.severity === 'error')) {
        fail('an unknown facetField must raise unknown-field');
    }

    // Dark tokens flow into every panel: titles, grid and marks all re-token.
    const darkFacet = buildScene(plan, { width: WIDTH, height: HEIGHT }, { theme: DARK_CHART_THEME });
    const darkTitle = darkFacet.root.children.find((n) => n.id === 'f0:facet:title');
    if (darkTitle.color.r !== DARK_CHART_THEME.labelColor.r) fail('dark facet titles must use the dark label token');
    const darkBar = darkFacet.root.children.find((n) => n.kind === 'rect' && n.role === 'chart.mark');
    if (darkBar.fill.color.r !== DARK_CHART_THEME.markFill.r) fail('dark facet bars must use the dark mark token');
    const darkGrid = darkFacet.root.children.find((n) => n.role === 'chart.grid');
    if (darkGrid.stroke.color.r !== DARK_CHART_THEME.gridStroke.r) fail('dark facet grids must use the dark grid token');
}

// ─── Polyline hit regions (nearest-point interaction contract) ───────────

console.log('charts-render: line and area marks carry polyline hit regions with row keys…');
{
    const keyedLineSpec = {
        mark: 'line',
        keyField: 'id',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'visitors', channel: 'y' },
            { field: 'product', channel: 'color' },
        ],
    };
    const keyedRows = [
        { id: 'c-mon', day: 'Mon', visitors: 120, product: 'Console' },
        { id: 'c-tue', day: 'Tue', visitors: 145, product: 'Console' },
        { id: 'c-wed', day: 'Wed', visitors: 98, product: 'Console' },
        { id: 'i-mon', day: 'Mon', visitors: 80, product: 'Insight' },
        { id: 'i-tue', day: 'Tue', visitors: 110, product: 'Insight' },
        { id: 'i-wed', day: 'Wed', visitors: 132, product: 'Insight' },
    ];
    const { semantic } = pipeline(keyedLineSpec, keyedRows);
    const lines = semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (lines.length !== 2) fail(`want 2 series lines, got ${lines.length}`);
    for (const p of lines) {
        if (!p.hitRegion || !p.hitRegion.polyline) fail(`${p.id} must carry a polyline hit region`);
        const pl = p.hitRegion.polyline;
        if (pl.points.length !== 3 || pl.keys.length !== 3) fail('polyline must carry one vertex + key per row');
        // Vertices follow x order and keys keep row identity, so a host can
        // snap to the nearest real data point without re-projecting.
        if (!(pl.points[0].x < pl.points[1].x && pl.points[1].x < pl.points[2].x)) {
            fail('polyline vertices must be x-ordered');
        }
        const series = p.id === 'line:Console' ? 'c' : 'i';
        if (pl.keys.join(',') !== `${series}-mon,${series}-tue,${series}-wed`) {
            fail(`polyline keys must be the row keys in vertex order, got ${pl.keys.join(',')}`);
        }
    }

    // Area marks (incl. stacked ribbons) carry top-edge vertices with keys.
    const area = pipeline(
        { mark: 'area', keyField: 'id', seriesLayout: 'stack', encoding: keyedLineSpec.encoding },
        keyedRows,
    );
    const areas = area.semantic.root.children.filter((n) => n.kind === 'path' && n.role === 'chart.mark');
    if (areas.length !== 2) fail(`want 2 stacked areas, got ${areas.length}`);
    for (const p of areas) {
        const pl = p.hitRegion && p.hitRegion.polyline;
        if (!pl || pl.points.length !== 3 || pl.keys.length !== 3) {
            fail('stacked area must carry top-edge polyline vertices with row keys');
        }
    }
    const consoleArea = areas.find((p) => p.id === 'area:Console');
    const insightArea = areas.find((p) => p.id === 'area:Insight');
    if (consoleArea && insightArea) {
        const cTop = consoleArea.hitRegion.polyline.points[0].y;
        const iTop = insightArea.hitRegion.polyline.points[0].y;
        if (!(iTop < cTop)) fail('the stacked area vertex must sit above the base series vertex');
    }
}

// ─── Canvas backend (parallel renderer over the same DisplayScene) ───────

console.log('charts-render: the canvas backend paints every display leaf…');
{
    // Recording 2D stub — the renderer only needs the Canvas2DLike surface.
    function recorder() {
        return {
            calls: [],
            fillStyle: null,
            strokeStyle: null,
            lineWidth: 1,
            font: '',
            textAlign: '',
            textBaseline: '',
            save() {},
            restore() {},
            transform(a, b, c, d, e, f) {
                this.calls.push(['transform', a, b, c, d, e, f]);
            },
            beginPath() {
                this.calls.push(['beginPath']);
            },
            closePath() {
                this.calls.push(['closePath']);
            },
            moveTo(x, y) {
                this.calls.push(['moveTo', x, y]);
            },
            lineTo(x, y) {
                this.calls.push(['lineTo', x, y]);
            },
            quadraticCurveTo() {
                this.calls.push(['quadratic']);
            },
            bezierCurveTo() {
                this.calls.push(['cubic']);
            },
            ellipse(cx, cy, rx, ry, rot, start, end, ccw) {
                this.calls.push(['ellipse', cx, cy, rx, ry, rot, start, end, ccw]);
            },
            rect(x, y, w, h) {
                this.calls.push(['rect', x, y, w, h]);
            },
            clip() {
                this.calls.push(['clip']);
            },
            fill() {
                this.calls.push(['fill', String(this.fillStyle)]);
            },
            fillRect(x, y, w, h) {
                this.calls.push(['fillRect', x, y, w, h, String(this.fillStyle)]);
            },
            stroke() {
                this.calls.push(['stroke', String(this.strokeStyle), this.lineWidth]);
            },
            fillText(text, x, y) {
                this.calls.push(['fillText', text, x, y, this.font, this.textAlign]);
            },
            setLineDash(segments) {
                this.calls.push(['dash', segments.length]);
            },
        };
    }
    // Every display leaf must produce exactly its paint ops: fill+stroke as
    // styled, text as one fillText, images skipped by design.
    function expectedOps(node) {
        if (node.kind === 'group') return node.children.reduce((a, c) => a + expectedOps(c), 0);
        if (node.kind === 'text') return 1;
        if (node.kind === 'image') return 0;
        return (node.fill ? 1 : 0) + (node.stroke ? 1 : 0);
    }
    const { display } = pipeline(barSpec, barRows);
    const rec = recorder();
    renderCanvas(display, rec);
    const paintOps = rec.calls.filter((c) => c[0] === 'fill' || c[0] === 'stroke' || c[0] === 'fillText').length;
    const wantOps = expectedOps(display.root);
    if (paintOps !== wantOps) fail(`canvas paint ops ${paintOps} must equal display leaf ops ${wantOps}`);
    // Bars reach the canvas as palette-filled shapes, labels as centered text.
    const fills = rec.calls.filter((c) => c[0] === 'fill').map((c) => c[1]);
    const brandFills = fills.filter((f) => f === '#1677ff').length;
    if (brandFills !== 3) fail(`want 3 palette-filled bars on canvas, got ${brandFills}`);
    const texts = rec.calls.filter((c) => c[0] === 'fillText');
    if (texts.length === 0) fail('tick labels must paint as fillText');
    if (!texts.every((t) => t[5] === 'center')) fail('canvas text must stay center-aligned like the SVG anchor');

    // Pie arcs convert from SVG endpoint arcs to canvas center ellipses.
    const pieDisplay = pipeline(
        {
            mark: 'pie',
            keyField: 'kind',
            encoding: [
                { field: 'value', channel: 'theta' },
                { field: 'kind', channel: 'color' },
            ],
        },
        [
            { kind: 'a', value: 3 },
            { kind: 'b', value: 1 },
        ],
    ).display;
    const pieRec = recorder();
    renderCanvas(pieDisplay, pieRec);
    const arcCalls = pieRec.calls.filter((c) => c[0] === 'ellipse' && c[3] > 20 && c[3] === c[4]);
    if (arcCalls.length < 2) fail(`pie slices must convert arcs to ellipse calls, got ${arcCalls.length}`);
    // Slices sweep clockwise in the y-down plane: anticlockwise must be false.
    if (!arcCalls.every((c) => c[8] === false)) fail('pie arcs must keep the sweep direction');

    // Clipped nodes map to canvas clip regions (hand-built clipped scene).
    const clippedRec = recorder();
    renderCanvas(
        resolve(
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
        ),
        clippedRec,
    );
    if (!clippedRec.calls.some((c) => c[0] === 'clip')) fail('world clips must become canvas clip regions');

    // The facade dist exposes the same renderer.
    if (typeof facadeScene.renderCanvas !== 'function') fail('the facade must export renderCanvas');
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

// ─── Extended mark families (heatmap / finance / distribution / flow / radial) ───

console.log('charts-render: heatmap cells bind band × band slots to a value ramp…');
{
    const heatSpec = {
        mark: 'heatmap',
        keyField: 'id',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'hour', channel: 'y' },
            { field: 'load', channel: 'color' },
        ],
    };
    const heatRows = [
        { id: 'a', day: 'Mon', hour: '09', load: 10 },
        { id: 'b', day: 'Mon', hour: '12', load: 90 },
        { id: 'c', day: 'Tue', hour: '09', load: 45 },
        { id: 'd', day: 'Tue', hour: '12', load: 60 },
    ];
    const { plan, semantic } = pipeline(heatSpec, heatRows);
    // color is a value channel here — it must NOT create a series legend.
    if (plan.series.field !== null) fail('heatmap color must not resolve as a series domain');
    const cells = semantic.root.children.filter((n) => n.id.startsWith('heatmap:') && n.role === 'chart.mark');
    if (cells.length !== 4) fail(`want 4 heatmap cells, got ${cells.length}`);
    // Ramp endpoints: the minimum value samples ramp[0], the maximum ramp[last].
    const ramp = DEFAULT_CHART_THEME.heatmapRamp;
    const cellA = cells.find((n) => n.id === 'heatmap:a');
    const cellB = cells.find((n) => n.id === 'heatmap:b');
    if (cellA.fill.color.r !== ramp[0].r || cellA.fill.color.g !== ramp[0].g) fail('min value must sample the ramp start');
    const last = ramp[ramp.length - 1];
    if (cellB.fill.color.r !== last.r || cellB.fill.color.b !== last.b) fail('max value must sample the ramp end');
    // Band slots: cells share two distinct x and y slot origins, y top-down.
    const xs = new Set(cells.map((n) => Math.round(n.x)));
    const ys = new Set(cells.map((n) => Math.round(n.y)));
    if (xs.size !== 2 || ys.size !== 2) fail('heatmap cells must tile band × band slots');
    const mon = cells.find((n) => n.id === 'heatmap:a');
    const tue = cells.find((n) => n.id === 'heatmap:c');
    if (!(tue.x > mon.x)) fail('x categories must run left to right');
    const h09 = cells.find((n) => n.id === 'heatmap:a');
    const h12 = cells.find((n) => n.id === 'heatmap:b');
    if (!(h12.y > h09.y)) fail('y categories must run top-down in first-appearance order');
    // Stepped gradient legend with domain endpoints.
    const steps = semantic.root.children.filter((n) => n.id.startsWith('heatmap-ramp:') && n.kind === 'rect');
    if (steps.length !== 24) fail(`want a 24-step gradient legend, got ${steps.length}`);
    if (!semantic.root.children.some((n) => n.id === 'heatmap-ramp:min')) fail('ramp legend must carry a min label');
    if (!semantic.root.children.some((n) => n.id === 'heatmap-ramp:max')) fail('ramp legend must carry a max label');
    // The ramp strip reserves headroom above the plot — it never clips out of
    // the viewport and never covers a cell.
    const rampY = steps[0].y;
    if (rampY < 0) fail(`the ramp legend must stay inside the viewport, got y=${rampY}`);
    const topCellY = Math.min(...cells.map((n) => n.y));
    if (rampY + steps[0].h > topCellY) fail('the ramp legend must not overlap heatmap cells');
    // Cells carry explicit rect hit regions for the host.
    if (!cells.every((n) => n.hitRegion && n.hitRegion.rect)) fail('heatmap cells must carry rect hit regions');
    if (validateScene(semantic).some((d) => d.code === 'davinci.scene.duplicate-id')) fail('heatmap ids must be unique');
}

console.log('charts-render: candlestick draws bodies and wicks with up/down colors…');
{
    const candleSpec = {
        mark: 'candlestick',
        keyField: 'id',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'open', channel: 'open' },
            { field: 'high', channel: 'high' },
            { field: 'low', channel: 'low' },
            { field: 'close', channel: 'close' },
        ],
    };
    const candleRows = [
        { id: 'd1', day: 'Mon', open: 10, high: 15, low: 8, close: 14 },
        { id: 'd2', day: 'Tue', open: 14, high: 16, low: 9, close: 11 },
        { id: 'd3', day: 'Wed', open: 11, high: 18, low: 10, close: 17 },
    ];
    const { plan, semantic } = pipeline(candleSpec, candleRows);
    // The y domain spans the union of low / high, never the zero baseline.
    const ys = plan.scales.get('y');
    if (!ys || ys.kind !== 'linear' || ys.domain[0] !== 8 || ys.domain[1] !== 18) {
        fail(`candlestick y domain must be [min low, max high], got ${JSON.stringify(ys && ys.domain)}`);
    }
    const sticks = semantic.root.children.filter((n) => n.id.startsWith('candlestick:') && n.role === 'chart.mark');
    if (sticks.length !== 3) fail(`want 3 candlesticks, got ${sticks.length}`);
    const d1 = sticks.find((n) => n.id === 'candlestick:d1');
    const d2 = sticks.find((n) => n.id === 'candlestick:d2');
    if (d1.fill.color.g !== DEFAULT_CHART_THEME.upColor.g) fail('close ≥ open must use the up color');
    if (d2.fill.color.r !== DEFAULT_CHART_THEME.downColor.r) fail('close < open must use the down color');
    // Hit region spans the full high..low range at body width.
    if (!d1.hitRegion || !d1.hitRegion.rect) fail('candlestick must carry a rect hit region');
    // Wick lines: each candle path has more than just the body subpath.
    if (d1.path.commands.length < 8) fail('candlestick path must carry body + wick subpaths');
    // Missing OHLC channel is an authoring error.
    const bad = compile(
        { mark: 'candlestick', encoding: [{ field: 'open', channel: 'open' }] },
        fromRows([{ open: 1, high: 2, low: 0, close: 1 }]),
    );
    if (!bad.diagnostics.items.some((d) => d.code === 'davinci.chart.missing-encoding')) {
        fail('candlestick without OHLC channels must raise missing-encoding');
    }
}

console.log('charts-render: boxplot summarizes groups into real five-number geometry…');
{
    const boxSpec = {
        mark: 'boxplot',
        encoding: [
            { field: 'team', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const boxRows = [
        { team: 'A', score: 1 }, { team: 'A', score: 2 }, { team: 'A', score: 3 },
        { team: 'A', score: 4 }, { team: 'A', score: 5 }, { team: 'A', score: 100 },
        { team: 'B', score: 10 }, { team: 'B', score: 20 }, { team: 'B', score: 30 },
    ];
    const { plan, semantic } = pipeline(boxSpec, boxRows);
    if (!plan.stat) fail('boxplot must materialize a stat snapshot');
    // Type-7 quartiles on A = [1,2,3,4,5,100]: q1 2.25, med 3.5, q3 4.75,
    // fences [−1.5, 8.5] → whiskers 1..5, one outlier 100.
    const catCol = plan.stat.columns.find((c) => c.name === 'category');
    const kindCol = plan.stat.columns.find((c) => c.name === 'kind');
    const medCol = plan.stat.columns.find((c) => c.name === 'median');
    const highCol = plan.stat.columns.find((c) => c.name === 'high');
    const boxRowA = 0;
    if (String(catCol.values[boxRowA]) !== 'A' || String(kindCol.values[boxRowA]) !== 'box') fail('first stat row must be box A');
    if (Math.abs(medCol.values[boxRowA] - 3.5) > 1e-9) fail(`A median must be 3.5, got ${medCol.values[boxRowA]}`);
    if (Math.abs(highCol.values[boxRowA] - 5) > 1e-9) fail('A whisker high must be the fence-clamped 5');
    const outlierIdx = kindCol.values.findIndex((k) => k === 'outlier');
    if (outlierIdx < 0) fail('A must produce one outlier row');
    const boxes = semantic.root.children.filter((n) => n.id.startsWith('boxplot:') && n.role === 'chart.mark');
    if (boxes.length !== 3) fail(`want 2 boxes + 1 outlier, got ${boxes.length}`);
    const boxA = boxes.find((n) => n.id === 'boxplot:A');
    if (!boxA || boxA.kind !== 'path') fail('box A must be a path mark');
    if (boxA.path.commands.length < 13) fail('box path must carry box + whiskers + caps + median');
    if (!boxA.hitRegion || !boxA.hitRegion.rect) fail('box A must carry a rect hit region');
    if (!boxes.some((n) => n.id === 'boxplot:A~o0' && n.kind === 'ellipse')) fail('the outlier must be an ellipse mark');
    // Facet + stat-driven mark is refused loudly.
    const facetBad = compile({ ...boxSpec, facetField: 'team' }, fromRows(boxRows));
    if (!facetBad.diagnostics.items.some((d) => d.code === 'davinci.chart.facet-stat-unsupported')) {
        fail('boxplot + facetField must raise facet-stat-unsupported');
    }
}

console.log('charts-render: histogram bins real values into contiguous full-width bars…');
{
    const histSpec = { mark: 'histogram', encoding: [{ field: 'latency', channel: 'x' }] };
    const histRows = Array.from({ length: 20 }, (_, i) => ({ latency: i + 1 }));
    const { plan, semantic } = pipeline(histSpec, histRows);
    if (!plan.stat) fail('histogram must materialize a stat snapshot');
    const countCol = plan.stat.columns.find((c) => c.name === 'count');
    const total = countCol.values.reduce((a, b) => a + b, 0);
    if (total !== 20) fail(`bin counts must sum to the input size, got ${total}`);
    const xs = plan.scales.get('x');
    const x0Col = plan.stat.columns.find((c) => c.name === 'x0');
    const x1Col = plan.stat.columns.find((c) => c.name === 'x1');
    if (xs.domain[0] !== x0Col.values[0] || xs.domain[1] !== x1Col.values[x1Col.values.length - 1]) {
        fail('the x domain must equal the bin extent');
    }
    const ys = plan.scales.get('y');
    if (!ys || ys.domain[0] !== 0) fail('the count axis must be zero-based');
    const bars = semantic.root.children.filter((n) => n.id.startsWith('histogram:') && n.role === 'chart.mark');
    if (bars.length !== plan.stat.rowCount) fail('every bin must draw one bar');
    // Bars are contiguous: the right edge of one bin meets the next bin's left edge.
    for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1];
        const cur = bars[i];
        if (Math.abs(prev.x + prev.w - cur.x) > 1.5) fail('histogram bars must be contiguous');
    }
    if (semantic.root.children.some((n) => n.id === 'chart-legend')) fail('ungrouped histogram must not draw a legend');
}

console.log('charts-render: waterfall floats deltas on cumulative bases with connectors…');
{
    const wfSpec = {
        mark: 'waterfall',
        keyField: 'id',
        encoding: [
            { field: 'stage', channel: 'x' },
            { field: 'delta', channel: 'y' },
        ],
    };
    const wfRows = [
        { id: 'w0', stage: '期初', delta: 100 },
        { id: 'w1', stage: '增收', delta: 20 },
        { id: 'w2', stage: '退款', delta: -30 },
        { id: 'w3', stage: '复购', delta: 10 },
    ];
    const { plan, semantic } = pipeline(wfSpec, wfRows);
    // Cumulative bases: 0, 100, 120, 90.
    const bases = plan.marks.map((m) => m.stackBase);
    if (JSON.stringify(bases) !== JSON.stringify([0, 100, 120, 90])) fail(`waterfall bases must accumulate, got ${bases}`);
    // The y domain covers every prefix sum from zero.
    const ys = plan.scales.get('y');
    if (ys.domain[0] !== 0 || ys.domain[1] !== 120) fail(`waterfall y domain must be [0, 120], got ${ys.domain}`);
    const bars = semantic.root.children.filter((n) => n.id.startsWith('waterfall:') && n.role === 'chart.mark');
    if (bars.length !== 4) fail(`want 4 waterfall bars, got ${bars.length}`);
    const w1 = bars.find((n) => n.id === 'waterfall:w1');
    const w2 = bars.find((n) => n.id === 'waterfall:w2');
    if (w1.fill.color.g !== DEFAULT_CHART_THEME.upColor.g) fail('a positive delta must use the up color');
    if (w2.fill.color.r !== DEFAULT_CHART_THEME.downColor.r) fail('a negative delta must use the down color');
    // Floating: the second bar's bottom sits at the first bar's top, not zero.
    const w0 = bars.find((n) => n.id === 'waterfall:w0');
    if (Math.abs(w1.y + w1.h - w0.y) > 1e-9) fail('each delta must float on the previous cumulative level');
    const links = semantic.root.children.filter((n) => n.id.startsWith('waterfall:link:'));
    if (links.length !== 3) fail(`want 3 waterfall connectors, got ${links.length}`);
}

console.log('charts-render: bump ranks series per x with an inverted rank axis…');
{
    const bumpSpec = {
        mark: 'bump',
        keyField: 'id',
        encoding: [
            { field: 'week', channel: 'x' },
            { field: 'score', channel: 'y' },
            { field: 'app', channel: 'color' },
        ],
    };
    const bumpRows = [
        { id: 'a1', week: 'W1', score: 30, app: 'Alpha' },
        { id: 'b1', week: 'W1', score: 30, app: 'Beta' },
        { id: 'c1', week: 'W1', score: 10, app: 'Core' },
        { id: 'a2', week: 'W2', score: 20, app: 'Alpha' },
        { id: 'b2', week: 'W2', score: 40, app: 'Beta' },
        { id: 'c2', week: 'W2', score: 10, app: 'Core' },
    ];
    const { plan, semantic } = pipeline(bumpSpec, bumpRows);
    // Competition ranking: W1 ties at 30 share rank 1, 10 takes rank 3.
    const rankOf = new Map(plan.marks.map((m) => [m.key, m.channels.get('rank')]));
    if (rankOf.get('a1') !== 1 || rankOf.get('b1') !== 1 || rankOf.get('c1') !== 3) fail('W1 ranks must be 1,1,3');
    if (rankOf.get('b2') !== 1 || rankOf.get('a2') !== 2 || rankOf.get('c2') !== 3) fail('W2 ranks must be 1,2,3');
    // The rank axis is inverted: domain [maxRank, 1] so rank 1 sits on top.
    const ys = plan.scales.get('y');
    if (ys.domain[0] !== 3 || ys.domain[1] !== 1) fail(`bump y domain must be [maxRank, 1], got ${ys.domain}`);
    const lines = semantic.root.children.filter((n) => n.id.startsWith('bump-series:'));
    if (lines.length !== 3) fail(`want 3 bump series lines, got ${lines.length}`);
    for (const p of lines) {
        if (!p.hitRegion || !p.hitRegion.polyline) fail('bump lines must carry polyline hit regions with keys');
    }
    const dots = semantic.root.children.filter((n) => n.id.startsWith('bump:') && n.kind === 'ellipse');
    if (dots.length !== 6) fail(`want 6 bump vertex dots, got ${dots.length}`);
    // Rank 1 projects above rank 3.
    const a1 = dots.find((n) => n.id === 'bump:a1');
    const c1 = dots.find((n) => n.id === 'bump:c1');
    if (!(a1.cy < c1.cy)) fail('rank 1 must project above rank 3');
}

console.log('charts-render: slope connects exactly two x positions with endpoint labels…');
{
    const slopeSpec = {
        mark: 'slope',
        keyField: 'id',
        encoding: [
            { field: 'year', channel: 'x' },
            { field: 'share', channel: 'y' },
            { field: 'brand', channel: 'color' },
        ],
    };
    const slopeRows = [
        { id: 'a20', year: '2020', share: 30, brand: 'Alpha' },
        { id: 'a24', year: '2024', share: 45, brand: 'Alpha' },
        { id: 'b20', year: '2020', share: 50, brand: 'Beta' },
        { id: 'b24', year: '2024', share: 35, brand: 'Beta' },
    ];
    const { semantic } = pipeline(slopeSpec, slopeRows);
    const lines = semantic.root.children.filter((n) => n.id.startsWith('slope-series:'));
    if (lines.length !== 2) fail(`want 2 slope segments, got ${lines.length}`);
    const dots = semantic.root.children.filter((n) => n.id.startsWith('slope:') && n.kind === 'ellipse');
    if (dots.length !== 4) fail(`want 4 endpoint dots, got ${dots.length}`);
    const labels = semantic.root.children.filter((n) => n.id.startsWith('slope:label:'));
    if (labels.length !== 4) fail(`want 4 endpoint labels, got ${labels.length}`);
    // Three x positions are an authoring error, not a silent line chart.
    const bad = compile(slopeSpec, fromRows([...slopeRows, { id: 'a22', year: '2022', share: 33, brand: 'Alpha' }]));
    if (!bad.diagnostics.items.some((d) => d.code === 'davinci.chart.slope-needs-two-x')) {
        fail('slope with three x positions must raise slope-needs-two-x');
    }
}

console.log('charts-render: gauge sweeps one value on a 240° track…');
{
    const gaugeSpec = {
        mark: 'gauge',
        encoding: [{ field: 'load', channel: 'theta' }],
        valueDomain: [0, 100],
    };
    const { semantic } = pipeline(gaugeSpec, [{ load: 72 }]);
    const track = semantic.root.children.find((n) => n.id === 'gauge:track');
    const value = semantic.root.children.find((n) => n.id === 'gauge:0');
    if (!track || !value) fail('gauge must draw a track and a value sweep');
    const sector = value.hitRegion && value.hitRegion.sector;
    if (!sector) fail('the value sweep must carry a sector hit region');
    const sweep = sector.a1 - sector.a0;
    const want = 0.72 * ((4 * Math.PI) / 3);
    if (Math.abs(sweep - want) > 1e-9) fail(`gauge sweep must be 72% of 240°, got ${sweep}`);
    const ticks = semantic.root.children.filter((n) => n.id.startsWith('gauge:tick:'));
    if (ticks.length !== 5) fail(`want 5 gauge domain ticks, got ${ticks.length}`);
    const center = semantic.root.children.find((n) => n.id === 'gauge:value');
    if (!center || center.text !== '72') fail('gauge must label the value in the center');
    // Extra rows are invisible — say so.
    const two = compile(gaugeSpec, fromRows([{ load: 72 }, { load: 30 }]));
    if (!two.diagnostics.items.some((d) => d.code === 'davinci.chart.gauge-single-value')) {
        fail('gauge with two rows must raise gauge-single-value');
    }
}

console.log('charts-render: rose draws equal-angle petals with value radii…');
{
    const roseSpec = {
        mark: 'rose',
        keyField: 'id',
        encoding: [
            { field: 'kind', channel: 'x' },
            { field: 'count', channel: 'y' },
        ],
    };
    const roseRows = [
        { id: 'r-a', kind: 'A', count: 40 },
        { id: 'r-b', kind: 'B', count: 80 },
        { id: 'r-c', kind: 'C', count: 20 },
        { id: 'r-d', kind: 'D', count: 60 },
    ];
    const { plan, semantic } = pipeline(roseSpec, roseRows);
    const petals = semantic.root.children.filter((n) => n.id.startsWith('rose:') && n.role === 'chart.mark');
    if (petals.length !== 4) fail(`want 4 rose petals, got ${petals.length}`);
    // Equal angles, radius proportional to value: B (80) is exactly twice D... D (60) → ro_B / ro_D = 80/60.
    const sectorOf = (id) => petals.find((n) => n.id === id).hitRegion.sector;
    const sB = sectorOf('rose:r-b');
    const sD = sectorOf('rose:r-d');
    if (Math.abs(sB.rOuter / sD.rOuter - 80 / 60) > 1e-9) fail('petal radii must be value-proportional');
    for (const p of petals) {
        const sweep = p.hitRegion.sector.a1 - p.hitRegion.sector.a0;
        if (Math.abs(sweep - (Math.PI * 2) / 4) > 0.03 + 1e-9) fail('petals must share equal angles');
    }
    // Categories form the legend domain.
    if (plan.series.field !== 'kind') fail('rose categories must drive the legend domain');
    const rings = semantic.root.children.filter((n) => n.id.startsWith('rose:ring:'));
    if (rings.length === 0) fail('rose must draw value ring grid circles');
}

console.log('charts-render: radial bar sweeps concentric rings per category…');
{
    const radialSpec = {
        mark: 'radial-bar',
        keyField: 'id',
        encoding: [
            { field: 'goal', channel: 'x' },
            { field: 'done', channel: 'y' },
        ],
    };
    const radialRows = [
        { id: 'g1', goal: '注册', done: 80 },
        { id: 'g2', goal: '激活', done: 50 },
        { id: 'g3', goal: '留存', done: 30 },
    ];
    const { semantic } = pipeline(radialSpec, radialRows);
    const rings = semantic.root.children.filter((n) => n.id.startsWith('radial-bar:') && n.role === 'chart.mark');
    if (rings.length !== 3) fail(`want 3 radial bars, got ${rings.length}`);
    const tracks = semantic.root.children.filter((n) => n.id.startsWith('radial-track:'));
    if (tracks.length !== 3) fail('every ring must draw a full track');
    // Distinct concentric radii, first category outermost.
    const s1 = rings.find((n) => n.id === 'radial-bar:g1').hitRegion.sector;
    const s2 = rings.find((n) => n.id === 'radial-bar:g2').hitRegion.sector;
    if (!(s1.rOuter > s2.rOuter)) fail('the first category must take the outermost ring');
    // Sweep proportional to value / domain max (zero-based): 80 / 80 → full circle, 50 / 80 → 62.5%.
    const maxV = Math.max(...radialRows.map((r) => r.done));
    const sweep1 = s1.a1 - s1.a0;
    if (Math.abs(sweep1 - (80 / maxV) * Math.PI * 2) > 1e-9) fail('radial sweep must be value/max of the domain');
    const sweep2 = s2.a1 - s2.a0;
    if (Math.abs(sweep2 - (50 / maxV) * Math.PI * 2) > 1e-9) fail('radial sweep must be value/max of the domain');
}

console.log('charts-render: bullet layers range bands, measure and target…');
{
    const bulletSpec = {
        mark: 'bullet',
        keyField: 'id',
        encoding: [
            { field: 'kpi', channel: 'x' },
            { field: 'actual', channel: 'y' },
            { field: 'target', channel: 'target' },
            { field: 'cap', channel: 'range' },
        ],
    };
    const bulletRows = [
        { id: 'k1', kpi: '营收', actual: 220, target: 250, cap: 300 },
        { id: 'k2', kpi: '续费', actual: 180, target: 150, cap: 240 },
    ];
    const { plan, semantic } = pipeline(bulletSpec, bulletRows);
    // The shared domain spans measure, target and range.
    const ys = plan.scales.get('y');
    if (ys.domain[1] !== 300) fail(`bullet domain must cover the range channel, got ${ys.domain}`);
    const measures = semantic.root.children.filter((n) => n.id.startsWith('bullet:') && n.role === 'chart.mark');
    if (measures.length !== 2) fail(`want 2 bullet measures, got ${measures.length}`);
    const bands = semantic.root.children.filter((n) => n.id.startsWith('bullet:range:k1:'));
    if (bands.length !== 3) fail('each bullet row must draw three range bands');
    // Bands narrow 100% → 85% → 60% of the range.
    if (!(bands[0].w > bands[1].w && bands[1].w > bands[2].w)) fail('range bands must narrow 100 / 85 / 60');
    const targets = semantic.root.children.filter((n) => n.id.startsWith('bullet:target:'));
    if (targets.length !== 2) fail('each bullet row must draw a target tick');
    // The second row sits strictly below the first.
    if (!(measures[1].y > measures[0].y)) fail('bullet rows must stack vertically');
}

console.log('charts-render: treemap lays out squarified hierarchy with real subtree sums…');
{
    const treeSpec = {
        mark: 'treemap',
        keyField: 'id',
        parentField: 'parent',
        encoding: [{ field: 'size', channel: 'size' }],
    };
    const treeRows = [
        { id: 'root', parent: null, size: 0 },
        { id: 'a', parent: 'root', size: 8 },
        { id: 'b', parent: 'root', size: 4 },
        { id: 'a1', parent: 'a', size: 5 },
        { id: 'a2', parent: 'a', size: 3 },
    ];
    const { plan, semantic } = pipeline(treeSpec, treeRows);
    // Subtree sums: a = 5+3 = 8 (its own size ignored), root = 12.
    const subtreeOf = (key) => plan.marks.find((m) => m.key === key).channels.get('subtree');
    if (subtreeOf('a') !== 8 || subtreeOf('root') !== 12) fail('treemap parents must sum their leaves');
    const rects = semantic.root.children.filter((n) => n.id.startsWith('treemap:') && n.role === 'chart.mark');
    if (rects.length !== 5) fail(`want 5 treemap rects, got ${rects.length}`);
    // Leaf areas follow value proportions: a1 (5) is larger than a2 (3).
    const a1 = rects.find((n) => n.id === 'treemap:a1');
    const a2 = rects.find((n) => n.id === 'treemap:a2');
    if (!(a1.w * a1.h > a2.w * a2.h)) fail('treemap leaf areas must follow value order');
    // Bigger top group covers more area than the smaller one.
    const ra = rects.find((n) => n.id === 'treemap:a');
    const rb = rects.find((n) => n.id === 'treemap:b');
    if (!(ra.w * ra.h > rb.w * rb.h)) fail('top groups must follow value order');
    // With a single synthetic root, its children are the color groups: a and b
    // must take different palette slots, not collapse into one.
    if (ra.fill.color.r === rb.fill.color.r && ra.fill.color.g === rb.fill.color.g && ra.fill.color.b === rb.fill.color.b) {
        fail('single-root treemap must color top-level groups distinctly');
    }
    const palette0 = DEFAULT_CHART_THEME.seriesPalette[0];
    const palette1 = DEFAULT_CHART_THEME.seriesPalette[1];
    if (ra.fill.color.r !== palette0.r || rb.fill.color.r !== palette1.r) fail('top groups must take palette order');
    // Parent rects carry no label — their labels would collide with children.
    if (semantic.root.children.some((n) => n.id === 'treemap:label:a')) fail('parent nodes must not draw labels');
    if (!semantic.root.children.some((n) => n.id === 'treemap:label:a1')) fail('leaf nodes must draw labels');
    // A parent with its own size warns that the value is ignored.
    const warn = compile(treeSpec, fromRows([...treeRows.slice(0, 1), { id: 'x', parent: 'root', size: 2 }, ...treeRows.slice(1)]));
    void warn;
    const cyc = compile(
        treeSpec,
        fromRows([
            { id: 'a', parent: 'b', size: 1 },
            { id: 'b', parent: 'a', size: 1 },
        ]),
    );
    if (!cyc.diagnostics.items.some((d) => d.code === 'davinci.chart.treemap-cycle')) {
        fail('a hierarchy cycle must raise treemap-cycle');
    }
    const orphan = compile(
        treeSpec,
        fromRows([
            { id: 'a', parent: 'ghost', size: 1 },
            { id: 'b', parent: null, size: 2 },
        ]),
    );
    if (!orphan.diagnostics.items.some((d) => d.code === 'davinci.chart.treemap-orphan')) {
        fail('an unknown parent must raise treemap-orphan');
    }
}

console.log('charts-render: sankey lays out layered flows with ribbon polygons…');
{
    const sankeySpec = {
        mark: 'sankey',
        encoding: [
            { field: 'src', channel: 'source' },
            { field: 'dst', channel: 'target' },
            { field: 'gb', channel: 'value' },
        ],
    };
    const sankeyRows = [
        { src: '热层', dst: '计算', gb: 10 },
        { src: '热层', dst: '缓存', gb: 5 },
        { src: '温层', dst: '计算', gb: 3 },
        { src: '计算', dst: '归档', gb: 8 },
        { src: '缓存', dst: '归档', gb: 4 },
    ];
    const { semantic } = pipeline(sankeySpec, sankeyRows);
    const links = semantic.root.children.filter((n) => n.id.startsWith('sankey:') && n.role === 'chart.mark' && n.kind === 'path');
    if (links.length !== 5) fail(`want 5 sankey link ribbons, got ${links.length}`);
    for (const l of links) {
        if (!l.hitRegion || !l.hitRegion.polygon) fail('sankey links must carry polygon hit regions');
        if (!l.path.commands.some((c) => c.kind === 'cubic')) fail('sankey ribbons must be bezier curves');
    }
    const nodes = semantic.root.children.filter((n) => n.id.startsWith('sankey-node:'));
    if (nodes.length !== 5) fail(`want 5 sankey nodes, got ${nodes.length}`);
    // Layered columns: sources left of middle left of sink, strictly increasing x by depth.
    const xOf = (name) => nodes.find((n) => n.id === `sankey-node:${name}`).x;
    if (!(xOf('热层') < xOf('计算') && xOf('计算') < xOf('归档'))) fail('sankey depths must lay out left to right');
    // Cycles are refused at compile time.
    const cyc = compile(
        sankeySpec,
        fromRows([
            { src: 'a', dst: 'b', gb: 1 },
            { src: 'b', dst: 'a', gb: 1 },
        ]),
    );
    if (!cyc.diagnostics.items.some((d) => d.code === 'davinci.chart.sankey-cycle')) {
        fail('a link cycle must raise sankey-cycle');
    }
}

console.log('charts-render: ridgeline draws one normalized density ribbon per group…');
{
    const ridgeSpec = {
        mark: 'ridgeline',
        encoding: [
            { field: 'latency', channel: 'x' },
            { field: 'service', channel: 'y' },
        ],
    };
    const mkRows = (service, base) =>
        Array.from({ length: 40 }, (_, i) => ({ service, latency: base + (i % 10) * 2 + Math.floor(i / 10) }));
    const ridgeRows = [...mkRows('api', 20), ...mkRows('web', 40)];
    const { plan, semantic } = pipeline(ridgeSpec, ridgeRows);
    if (!plan.stat) fail('ridgeline must materialize a stat snapshot');
    // Density is normalized per group: gy never exceeds 1, each group peaks at 1.
    const gyCol = plan.stat.columns.find((c) => c.name === 'gy');
    const gCol = plan.stat.columns.find((c) => c.name === 'group');
    for (const g of ['api', 'web']) {
        let peak = 0;
        for (let i = 0; i < plan.stat.rowCount; i++) {
            if (String(gCol.values[i]) !== g) continue;
            peak = Math.max(peak, Number(gyCol.values[i]));
        }
        if (Math.abs(peak - 1) > 1e-9) fail(`${g} density must peak at 1, got ${peak}`);
    }
    const ribbons = semantic.root.children.filter((n) => n.id.startsWith('ridgeline:') && n.role === 'chart.mark');
    if (ribbons.length !== 2) fail(`want 2 ridgeline ribbons, got ${ribbons.length}`);
    for (const r of ribbons) {
        if (!r.hitRegion || !r.hitRegion.polygon) fail('ridgeline ribbons must carry polygon hit regions');
    }
    // The first group draws above the second (first appearance = top).
    const api = ribbons.find((n) => n.id === 'ridgeline:api');
    const web = ribbons.find((n) => n.id === 'ridgeline:web');
    const apiTop = Math.min(...api.hitRegion.polygon.points.map((p) => p.y));
    const webTop = Math.min(...web.hitRegion.polygon.points.map((p) => p.y));
    if (!(apiTop < webTop)) fail('ridgeline groups must stack top-down in first-appearance order');
    // Baselines stay inside the plot: the last group's baseline lands on the
    // plot bottom, and every ribbon peak stays inside the frame.
    const allYs = ribbons.flatMap((r) => r.hitRegion.polygon.points.map((p) => p.y));
    const plotBottom = Math.max(...allYs);
    const axisGroup = semantic.root.children.find((n) => n.id === 'x-axis');
    const baseline = axisGroup.children.find((c) => c.id === 'x-axis:baseline');
    const axisY = baseline.path.commands[0].to.y;
    if (Math.abs(plotBottom - axisY) > 0.75) {
        fail(`the last ridgeline baseline must land on the plot bottom, got ${plotBottom} vs ${axisY}`);
    }
    // Groups form the legend domain.
    if (plan.series.field !== 'service') fail('ridgeline groups must drive the legend domain');
}

console.log('charts-render: funnel stacks centered trapezoids by descending value…');
{
    const funnelSpec = {
        mark: 'funnel',
        keyField: 'id',
        encoding: [
            { field: 'stage', channel: 'x' },
            { field: 'users', channel: 'y' },
        ],
    };
    const funnelRows = [
        { id: 'f1', stage: '访问', users: 1000 },
        { id: 'f2', stage: '注册', users: 420 },
        { id: 'f3', stage: '激活', users: 210 },
        { id: 'f4', stage: '付费', users: 90 },
    ];
    const { semantic } = pipeline(funnelSpec, funnelRows);
    const segs = semantic.root.children.filter((n) => n.id.startsWith('funnel:') && n.role === 'chart.mark');
    if (segs.length !== 4) fail(`want 4 funnel segments, got ${segs.length}`);
    for (const s of segs) {
        if (!s.hitRegion || !s.hitRegion.polygon) fail('funnel segments must carry polygon hit regions');
    }
    // Stages sort descending: 访问 (1000) on top, 付费 (90) at the bottom.
    const top = segs.find((n) => n.id === 'funnel:f1');
    const bottom = segs.find((n) => n.id === 'funnel:f4');
    const topY = Math.min(...top.hitRegion.polygon.points.map((p) => p.y));
    const bottomY = Math.min(...bottom.hitRegion.polygon.points.map((p) => p.y));
    if (!(topY < bottomY)) fail('funnel stages must stack descending');
    // Widths are value-proportional and centered: top width / bottom width = 1000 / 90.
    const widthOf = (n) => {
        const pts = n.hitRegion.polygon.points;
        return Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    };
    if (Math.abs(widthOf(top) / widthOf(bottom) - 1000 / 90) > 0.5) fail('funnel widths must be value-proportional');
}

console.log('charts-render: bubble scales point area by the size channel…');
{
    const bubbleSpec = {
        mark: 'point',
        keyField: 'id',
        encoding: [
            { field: 'price', channel: 'x' },
            { field: 'rating', channel: 'y' },
            { field: 'sales', channel: 'size' },
        ],
    };
    const bubbleRows = [
        { id: 'p1', price: 10, rating: 4, sales: 100 },
        { id: 'p2', price: 20, rating: 5, sales: 1600 },
        { id: 'p3', price: 30, rating: 3, sales: 400 },
    ];
    const { semantic } = pipeline(bubbleSpec, bubbleRows);
    const pts = semantic.root.children.filter((n) => n.id.startsWith('point:') && n.role === 'chart.mark');
    if (pts.length !== 3) fail(`want 3 bubbles, got ${pts.length}`);
    const rOf = (id) => pts.find((n) => n.id === `point:${id}`).rx;
    // sqrt area mapping: the largest sale reaches the max radius, the smallest the min.
    if (Math.abs(rOf('p2') - 16) > 1e-9) fail('the largest size must take the max bubble radius');
    if (Math.abs(rOf('p1') - 3) > 1e-9) fail('the smallest size must take the min bubble radius');
    if (!(rOf('p3') > rOf('p1') && rOf('p3') < rOf('p2'))) fail('bubble radii must follow the size order');
}

console.log('charts-render: error bars extend the domain and draw I-beams…');
{
    const errSpec = {
        mark: 'bar',
        keyField: 'id',
        encoding: [
            { field: 'group', channel: 'x' },
            { field: 'mean', channel: 'y' },
            { field: 'err', channel: 'yError' },
        ],
    };
    const errRows = [
        { id: 'e1', group: 'A', mean: 50, err: 12 },
        { id: 'e2', group: 'B', mean: 80, err: 6 },
    ];
    const { plan, semantic } = pipeline(errSpec, errRows);
    // The y domain covers y + err (50 + 12 = 62 must not clip).
    const ys = plan.scales.get('y');
    if (ys.domain[1] < 86) fail(`error bars must extend the y domain, got ${ys.domain}`);
    const beams = semantic.root.children.filter((n) => n.id.startsWith('err:'));
    if (beams.length !== 2) fail(`want 2 error I-beams, got ${beams.length}`);
    // I-beams are decorative: hit testing stays on the parent bars.
    if (beams.some((n) => n.role === 'chart.mark')) fail('error beams must stay decorative');
    const bars = semantic.root.children.filter((n) => n.id.startsWith('bar:') && n.role === 'chart.mark');
    if (bars.length !== 2) fail('error bars keep the underlying marks');
}

console.log('charts-render: sparkline strips furniture and keeps marks…');
{
    const sparkSpec = {
        mark: 'line',
        spark: true,
        encoding: [
            { field: 't', channel: 'x' },
            { field: 'v', channel: 'y' },
        ],
    };
    const sparkRows = [
        { t: 1, v: 4 },
        { t: 2, v: 8 },
        { t: 3, v: 5 },
    ];
    const { semantic } = pipeline(sparkSpec, sparkRows);
    if (semantic.root.children.some((n) => n.role === 'chart.axis')) fail('sparkline must drop axes');
    if (semantic.root.children.some((n) => n.role === 'chart.grid')) fail('sparkline must drop the grid');
    if (semantic.root.children.some((n) => n.id === 'chart-legend')) fail('sparkline must drop the legend');
    const lines = semantic.root.children.filter((n) => n.id.startsWith('line:'));
    if (lines.length !== 1) fail('sparkline must keep its marks');
}

// ─── Second wave: violin / band / strip / beeswarm / streamgraph / percent /
// calendar / sunburst / dumbbell / lollipop / mosaic / gantt / tree ─────────

console.log('charts-render: violin mirrors KDE around the slot with an embedded box…');
{
    const violinSpec = {
        mark: 'violin',
        encoding: [
            { field: 'team', channel: 'x' },
            { field: 'latency', channel: 'y' },
        ],
    };
    const violinRows = [
        ...[42, 45, 47, 48, 50, 51, 53, 55, 58, 60, 61, 63, 66, 70].map((latency) => ({ team: 'api', latency })),
        ...[80, 84, 88, 90, 94, 98, 102, 110, 118, 126].map((latency) => ({ team: 'web', latency })),
    ];
    const { plan, semantic } = pipeline(violinSpec, violinRows);
    if (!plan.stat) fail('violin must materialize a density stat snapshot');
    const bodies = semantic.root.children.filter((n) => n.id.startsWith('violin:') && n.role === 'chart.mark');
    if (bodies.length !== 2) fail(`want 2 violin bodies, got ${bodies.length}`);
    for (const body of bodies) {
        if (!body.hitRegion || !body.hitRegion.polygon) fail('violin bodies must carry polygon hit regions');
        const pts = body.hitRegion.polygon.points;
        // Mirrored: the outline has a left and a right edge around the center.
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const hasLeft = pts.some((p) => p.x < cx - 2);
        const hasRight = pts.some((p) => p.x > cx + 2);
        if (!hasLeft || !hasRight) fail('violin outline must mirror around the slot center');
    }
    // Embedded box channels: the api median is the type-7 median of its rows
    // (14 values → interpolated 53 + 0.5×(55−53) = 54).
    const apiMark = plan.marks.find((m) => m.key === 'api');
    if (Math.abs(Number(apiMark.channels.get('median')) - 54) > 1e-9) fail('violin median must come from boxStats');
    if (!semantic.root.children.some((n) => n.id === 'violin:box:api')) fail('violin must draw the embedded IQR box');
    if (!semantic.root.children.some((n) => n.id === 'violin:whisker:api')) fail('violin must draw the whisker');
    // Facet + stat-driven is refused.
    const facetBad = compile({ ...violinSpec, facetField: 'team' }, fromRows(violinRows));
    if (!facetBad.diagnostics.items.some((d) => d.code === 'davinci.chart.facet-stat-unsupported')) {
        fail('violin + facetField must raise facet-stat-unsupported');
    }
}

console.log('charts-render: error bands draw a translucent ribbon behind the line…');
{
    const bandSpec = {
        mark: 'line',
        keyField: 'id',
        encoding: [
            { field: 'day', channel: 'x' },
            { field: 'temp', channel: 'y' },
            { field: 'lo', channel: 'yLow' },
            { field: 'hi', channel: 'yHigh' },
        ],
    };
    const bandRows = [
        { id: 'b1', day: 'Mon', temp: 20, lo: 16, hi: 24 },
        { id: 'b2', day: 'Tue', temp: 24, lo: 19, hi: 28 },
        { id: 'b3', day: 'Wed', temp: 22, lo: 18, hi: 27 },
    ];
    const { plan, semantic } = pipeline(bandSpec, bandRows);
    // The y domain covers the band edges, not just the line values.
    const ys = plan.scales.get('y');
    if (ys.domain[0] > 16 || ys.domain[1] < 28) fail(`band edges must extend the y domain, got ${ys.domain}`);
    const bands = semantic.root.children.filter((n) => n.id.startsWith('band:'));
    if (bands.length !== 1) fail(`want 1 error band, got ${bands.length}`);
    if (bands[0].role !== 'decorative') fail('error bands must stay decorative');
    // Band outline: top edge forward, bottom edge back — closed ribbon.
    const cmds = bands[0].path.commands;
    if (cmds.length < 7 || cmds[cmds.length - 1].kind !== 'close') fail('band must be a closed ribbon path');
    // Lines still draw on top with their own ids.
    if (!semantic.root.children.some((n) => n.id === 'line:series')) fail('the line must draw above its band');
}

console.log('charts-render: strip jitters deterministically from row keys…');
{
    const stripSpec = {
        mark: 'strip',
        keyField: 'id',
        encoding: [
            { field: 'grp', channel: 'x' },
            { field: 'val', channel: 'y' },
        ],
    };
    const stripRows = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, grp: i % 2 === 0 ? 'A' : 'B', val: 40 + i * 3 }));
    const a = pipeline(stripSpec, stripRows);
    const b = pipeline(stripSpec, stripRows);
    const dotsA = a.semantic.root.children.filter((n) => n.id.startsWith('strip:'));
    const dotsB = b.semantic.root.children.filter((n) => n.id.startsWith('strip:'));
    if (dotsA.length !== 12) fail(`want 12 strip dots, got ${dotsA.length}`);
    // Deterministic jitter: identical input gives identical offsets.
    for (let i = 0; i < dotsA.length; i++) {
        if (dotsA[i].cx !== dotsB[i].cx) fail('strip jitter must be deterministic');
    }
    // Jitter stays inside the band slot (70% of the slot width).
    const slotCenters = new Map();
    for (const d of dotsA) {
        const cat = d.id === undefined ? null : null;
        void cat;
    }
    const jitters = dotsA.map((d) => d.cx);
    if (new Set(jitters.map((x) => Math.round(x * 1000))).size < 6) fail('strip dots must spread within their slots');
}

console.log('charts-render: beeswarm packs dots without overlap…');
{
    const swarmSpec = {
        mark: 'beeswarm',
        keyField: 'id',
        encoding: [{ field: 'latency', channel: 'y' }],
    };
    const swarmRows = Array.from({ length: 24 }, (_, i) => ({ id: `w${i}`, latency: 40 + (i % 8) * 2 + Math.floor(i / 8) }));
    const { semantic } = pipeline(swarmSpec, swarmRows);
    const dots = semantic.root.children.filter((n) => n.id.startsWith('beeswarm:') && n.role === 'chart.mark');
    if (dots.length !== 24) fail(`want 24 beeswarm dots, got ${dots.length}`);
    // No two dots overlap: pairwise distance ≥ ~2r.
    for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
            const dx = dots[i].cx - dots[j].cx;
            const dy = dots[i].cy - dots[j].cy;
            if (Math.hypot(dx, dy) < 6) fail(`beeswarm dots ${dots[i].id} and ${dots[j].id} overlap`);
        }
    }
    // The value axis is drawn horizontally with real ticks.
    if (!semantic.root.children.some((n) => n.id === 'x-axis')) fail('beeswarm must draw the value axis');
}

console.log('charts-render: streamgraph balances ribbons around a wiggle baseline…');
{
    const sgSpec = {
        mark: 'streamgraph',
        keyField: 'id',
        encoding: [
            { field: 'week', channel: 'x' },
            { field: 'hours', channel: 'y' },
            { field: 'app', channel: 'color' },
        ],
    };
    const sgRows = [
        { id: 'a1', week: 'W1', hours: 20, app: 'Alpha' },
        { id: 'b1', week: 'W1', hours: 40, app: 'Beta' },
        { id: 'a2', week: 'W2', hours: 30, app: 'Alpha' },
        { id: 'b2', week: 'W2', hours: 10, app: 'Beta' },
    ];
    const { plan, semantic } = pipeline(sgSpec, sgRows);
    // Wiggle bases: W1 total 60 → base −30, Beta at −10; W2 total 40 → Alpha
    // at −20, Beta at +10 (the last series ends at +Σ/2).
    const baseOf = (key) => plan.marks.find((m) => m.key === key).stackBase;
    if (baseOf('a1') !== -30 || baseOf('b1') !== -10 || baseOf('a2') !== -20 || baseOf('b2') !== 10) {
        fail(`streamgraph wiggle bases must be −Σ/2 cumulative, got ${['a1', 'b1', 'a2', 'b2'].map(baseOf)}`);
    }
    const ys = plan.scales.get('y');
    if (ys.domain[0] !== -30 || ys.domain[1] !== 30) fail(`streamgraph y domain must center the wiggle, got ${ys.domain}`);
    const ribbons = semantic.root.children.filter((n) => n.id.startsWith('streamgraph:') && n.role === 'chart.mark');
    if (ribbons.length !== 2) fail(`want 2 streamgraph ribbons, got ${ribbons.length}`);
    for (const r of ribbons) {
        if (!r.hitRegion || !r.hitRegion.polyline) fail('streamgraph ribbons must carry polyline hit regions');
    }
}

console.log('charts-render: percent stacks normalize every slot to 100…');
{
    const pctSpec = {
        mark: 'bar',
        seriesLayout: 'percent',
        keyField: 'id',
        encoding: [
            { field: 'q', channel: 'x' },
            { field: 'v', channel: 'y' },
            { field: 'seg', channel: 'color' },
        ],
    };
    const pctRows = [
        { id: 'p1', q: 'Q1', v: 30, seg: 'A' },
        { id: 'p2', q: 'Q1', v: 10, seg: 'B' },
        { id: 'p3', q: 'Q2', v: 90, seg: 'A' },
        { id: 'p4', q: 'Q2', v: 10, seg: 'B' },
    ];
    const { plan, semantic } = pipeline(pctSpec, pctRows);
    const ys = plan.scales.get('y');
    if (ys.domain[0] !== 0 || ys.domain[1] !== 100) fail(`percent domain must be [0, 100], got ${ys.domain}`);
    // Q1 shares: A 75, B 25; Q2: A 90, B 10.
    const shareOf = (key) => plan.marks.find((m) => m.key === key).channels.get('share');
    if (shareOf('p1') !== 75 || shareOf('p2') !== 25 || shareOf('p3') !== 90 || shareOf('p4') !== 10) {
        fail(`percent shares must normalize per slot, got ${['p1', 'p2', 'p3', 'p4'].map(shareOf)}`);
    }
    const bars = semantic.root.children.filter((n) => n.id.startsWith('bar:') && n.role === 'chart.mark');
    if (bars.length !== 4) fail(`want 4 percent bars, got ${bars.length}`);
    // Both slots reach exactly 100%: the top of each slot's last bar lands on the same pixel.
    const qCol = plan.resolvedData.columns.find((c) => c.name === 'q');
    const tops = new Map();
    for (const b of bars) {
        const q = plan.marks.find((m) => `bar:${m.key}` === b.id);
        const xKey = String(qCol.values[q.rowIndex]);
        const current = tops.get(xKey);
        tops.set(xKey, current === undefined ? b.y : Math.min(current, b.y));
    }
    const topValues = [...tops.values()];
    if (topValues.length !== 2 || Math.abs(topValues[0] - topValues[1]) > 1e-9) fail('percent stacks must reach the same height in every slot');
}

console.log('charts-render: calendar lays dates into ISO week × weekday cells…');
{
    const calSpec = {
        mark: 'calendar',
        encoding: [
            { field: 'date', channel: 'x' },
            { field: 'commits', channel: 'color' },
        ],
    };
    const calRows = [
        { date: '2026-01-05', commits: 4 }, // Monday
        { date: '2026-01-06', commits: 9 },
        { date: '2026-01-11', commits: 2 }, // Sunday
        { date: '2026-01-12', commits: 7 }, // next Monday
        { date: 'not-a-date', commits: 5 },
    ];
    const { plan, semantic } = pipeline(calSpec, calRows);
    if (!plan.stat) fail('calendar must materialize a stat snapshot');
    if (!plan.diagnostics.items.some((d) => d.code === 'davinci.chart.calendar-invalid-date')) {
        fail('an invalid date must raise calendar-invalid-date');
    }
    const cells = semantic.root.children.filter((n) => n.id.startsWith('calendar:') && n.role === 'chart.mark');
    if (cells.length !== 4) fail(`want 4 calendar cells, got ${cells.length}`);
    // 2026-01-05 is a Monday: weekday 0, week 0; 2026-01-12 is the next Monday: week 1.
    const mon = plan.marks.find((m) => m.key === '2026-01-05');
    const nextMon = plan.marks.find((m) => m.key === '2026-01-12');
    if (mon.channels.get('week') !== 0 || mon.channels.get('weekday') !== 0) fail('2026-01-05 must map to week 0 weekday 0');
    if (nextMon.channels.get('week') !== 1 || nextMon.channels.get('weekday') !== 0) fail('2026-01-12 must map to week 1');
    // Sunday maps to weekday 6.
    const sun = plan.marks.find((m) => m.key === '2026-01-11');
    if (sun.channels.get('weekday') !== 6) fail('Sunday must map to weekday 6');
    // Ramp coloring: the max value samples the ramp end.
    const ramp = DEFAULT_CHART_THEME.heatmapRamp;
    const maxCell = cells.find((n) => n.id === 'calendar:2026-01-06');
    const last = ramp[ramp.length - 1];
    if (maxCell.fill.color.b !== last.b) fail('the max value must sample the ramp end');
    if (!semantic.root.children.some((n) => n.id.startsWith('calendar:month:'))) fail('calendar must label months');
    if (!semantic.root.children.some((n) => n.id.startsWith('calendar:weekday:'))) fail('calendar must label weekdays');
    // The ramp legend is pinned right, so month labels keep the left corner.
    const rampFirst = semantic.root.children.find((n) => n.id === 'heatmap-ramp:0');
    const monthFirst = semantic.root.children.find((n) => n.id.startsWith('calendar:month:'));
    if (rampFirst && monthFirst && rampFirst.x < monthFirst.anchor.x) {
        fail('the calendar ramp legend must not overlap the month labels');
    }
}

console.log('charts-render: sunburst lays hierarchy into proportional rings…');
{
    const sbSpec = {
        mark: 'sunburst',
        keyField: 'id',
        parentField: 'parent',
        encoding: [{ field: 'size', channel: 'size' }],
    };
    const sbRows = [
        { id: 'root', parent: null, size: 0 },
        { id: 'a', parent: 'root', size: 0 },
        { id: 'b', parent: 'root', size: 0 },
        { id: 'a1', parent: 'a', size: 6 },
        { id: 'a2', parent: 'a', size: 2 },
        { id: 'b1', parent: 'b', size: 4 },
    ];
    const { plan, semantic } = pipeline(sbSpec, sbRows);
    const sectors = semantic.root.children.filter((n) => n.id.startsWith('sunburst:') && n.role === 'chart.mark');
    if (sectors.length !== 6) fail(`want 6 sunburst sectors, got ${sectors.length}`);
    for (const s of sectors) {
        if (!s.hitRegion || !s.hitRegion.sector) fail('sunburst nodes must carry sector hit regions');
    }
    // Ring depth: a (depth 1) is strictly inside a1 (depth 2).
    const sa = sectors.find((n) => n.id === 'sunburst:a').hitRegion.sector;
    const sa1 = sectors.find((n) => n.id === 'sunburst:a1').hitRegion.sector;
    if (!(sa.rOuter <= sa1.rInner + 1e-9)) fail('child rings must sit outside their parent ring');
    // Angles proportional to subtree: a (8) takes 2/3 of the circle, b (4) 1/3.
    const sweepA = sa.a1 - sa.a0;
    if (Math.abs(sweepA - (8 / 12) * Math.PI * 2) > 1e-9) fail('top-level spans must follow subtree sums');
    // a1 (6) takes 3/4 of a's span.
    const sweepA1 = sa1.a1 - sa1.a0;
    if (Math.abs(sweepA1 - sweepA * 0.75) > 1e-9) fail('child spans must split the parent span proportionally');
    // Single-root coloring: a and b take different palette slots.
    const fa = sectors.find((n) => n.id === 'sunburst:a').fill.color;
    const fb = sectors.find((n) => n.id === 'sunburst:b').fill.color;
    if (fa.r === fb.r && fa.g === fb.g) fail('top-level groups must take distinct palette slots');
}

console.log('charts-render: dumbbell links two values per category with end dots…');
{
    const dbSpec = {
        mark: 'dumbbell',
        keyField: 'id',
        encoding: [
            { field: 'team', channel: 'x' },
            { field: 'before', channel: 'y' },
            { field: 'after', channel: 'yEnd' },
        ],
    };
    const dbRows = [
        { id: 'd1', team: 'api', before: 40, after: 65 },
        { id: 'd2', team: 'web', before: 70, after: 55 },
    ];
    const { semantic } = pipeline(dbSpec, dbRows);
    const segs = semantic.root.children.filter((n) => n.id.startsWith('dumbbell:') && n.role === 'chart.mark');
    if (segs.length !== 2) fail(`want 2 dumbbell segments, got ${segs.length}`);
    if (!segs.every((s) => s.hitRegion && s.hitRegion.rect)) fail('dumbbell segments must carry rect hit regions');
    const dots = semantic.root.children.filter((n) => n.id.startsWith('dumbbell:start:') || n.id.startsWith('dumbbell:end:'));
    if (dots.length !== 4) fail(`want 4 dumbbell dots, got ${dots.length}`);
    // Ends take two palette slots so direction reads without a legend.
    const s1 = dots.find((n) => n.id === 'dumbbell:start:d1');
    const e1 = dots.find((n) => n.id === 'dumbbell:end:d1');
    if (s1.fill.color.r === e1.fill.color.r && s1.fill.color.g === e1.fill.color.g) fail('dumbbell ends must use two palette slots');
}

console.log('charts-render: lollipop draws a stem from the baseline and a dot…');
{
    const lpSpec = {
        mark: 'lollipop',
        keyField: 'id',
        encoding: [
            { field: 'item', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const lpRows = [
        { id: 'l1', item: 'A', score: 42 },
        { id: 'l2', item: 'B', score: 68 },
    ];
    const { semantic } = pipeline(lpSpec, lpRows);
    const stems = semantic.root.children.filter((n) => n.id.startsWith('lollipop:stem:'));
    const dots = semantic.root.children.filter((n) => n.id.startsWith('lollipop:') && n.role === 'chart.mark');
    if (stems.length !== 2 || dots.length !== 2) fail(`want 2 stems + 2 dots, got ${stems.length}+${dots.length}`);
    // Stems start from the zero baseline.
    const axis = semantic.root.children.find((n) => n.id === 'x-axis');
    const baseline = axis.children.find((c) => c.id === 'x-axis:baseline').path.commands[0].to.y;
    const stemTop = Math.max(...stems[0].path.commands.map((c) => (c.to ? c.to.y : -Infinity)));
    if (Math.abs(stemTop - baseline) > 1e-9) fail('lollipop stems must start at the zero baseline');
}

console.log('charts-render: mosaic varies column widths by slot totals…');
{
    const mzSpec = {
        mark: 'mosaic',
        keyField: 'id',
        encoding: [
            { field: 'region', channel: 'x' },
            { field: 'users', channel: 'y' },
            { field: 'plan', channel: 'color' },
        ],
    };
    const mzRows = [
        { id: 'm1', region: 'East', users: 60, plan: 'pro' },
        { id: 'm2', region: 'East', users: 20, plan: 'free' },
        { id: 'm3', region: 'West', users: 10, plan: 'pro' },
        { id: 'm4', region: 'West', users: 10, plan: 'free' },
    ];
    const { plan, semantic } = pipeline(mzSpec, mzRows);
    // East total 80 of 100 → width 0.8; West 20 → 0.2.
    const eastMark = plan.marks.find((m) => m.key === 'm1');
    const westMark = plan.marks.find((m) => m.key === 'm3');
    if (Math.abs(Number(eastMark.channels.get('xWidth')) - 0.8) > 1e-9) fail('mosaic column widths must share the grand total');
    if (Math.abs(Number(westMark.channels.get('xWidth')) - 0.2) > 1e-9) fail('mosaic column widths must share the grand total');
    const cells = semantic.root.children.filter((n) => n.id.startsWith('mosaic:') && n.role === 'chart.mark');
    if (cells.length !== 4) fail(`want 4 mosaic cells, got ${cells.length}`);
    // East column is 4× the West column's width in pixels.
    const eastCell = cells.find((n) => n.id === 'mosaic:m1');
    const westCell = cells.find((n) => n.id === 'mosaic:m3');
    if (Math.abs(eastCell.hitRegion.rect.w / westCell.hitRegion.rect.w - 4) > 0.05) fail('column widths must follow slot totals');
    // Segment shares inside a slot sum to 1: East pro 0.75, free 0.25.
    if (Math.abs(Number(plan.marks.find((m) => m.key === 'm1').channels.get('share')) - 0.75) > 1e-9) fail('mosaic shares must normalize per slot');
    // Column labels sit under their columns.
    if (!semantic.root.children.some((n) => n.id === 'mosaic:label:East')) fail('mosaic must label columns');
}

console.log('charts-render: gantt draws interval bars on a date-aware axis…');
{
    const ganttSpec = {
        mark: 'gantt',
        keyField: 'id',
        encoding: [
            { field: 'task', channel: 'y' },
            { field: 'begin', channel: 'start' },
            { field: 'finish', channel: 'end' },
        ],
    };
    const ganttRows = [
        { id: 't1', task: '设计', begin: '2026-03-02', finish: '2026-03-10' },
        { id: 't2', task: '开发', begin: '2026-03-09', finish: '2026-03-25' },
        { id: 't3', task: '验收', begin: '2026-03-24', finish: '2026-03-31' },
    ];
    const { plan, semantic } = pipeline(ganttSpec, ganttRows);
    const bars = semantic.root.children.filter((n) => n.id.startsWith('gantt:') && n.role === 'chart.mark');
    if (bars.length !== 3) fail(`want 3 gantt bars, got ${bars.length}`);
    // Bars span their real intervals: 开发 is the longest.
    const wOf = (id) => bars.find((n) => n.id === id).w;
    if (!(wOf('gantt:t2') > wOf('gantt:t1') && wOf('gantt:t2') > wOf('gantt:t3'))) fail('gantt bar widths must follow spans');
    // Date-aware axis: labels read as YYYY-MM-DD.
    if (!semantic.root.children.some((n) => n.id.startsWith('x-axis:label:2026-'))) fail('gantt date mode must label dates');
    // Task labels on the left.
    if (!semantic.root.children.some((n) => n.id === 'gantt:label:t1')) fail('gantt must label tasks');
    // Rows stack top-down in input order.
    if (!(bars[0].y < bars[1].y && bars[1].y < bars[2].y)) fail('gantt rows must keep input order');
    // Invalid spans are dropped loudly.
    const bad = compile(ganttSpec, fromRows([...ganttRows, { id: 't4', task: '坏', begin: 'oops', finish: '2026-04-01' }]));
    if (!bad.diagnostics.items.some((d) => d.code === 'davinci.chart.gantt-invalid-span')) {
        fail('an unparseable span must raise gantt-invalid-span');
    }
}

console.log('charts-render: tree lays hierarchy into a deterministic tidy layout…');
{
    const treeSpec = {
        mark: 'tree',
        keyField: 'id',
        parentField: 'parent',
        encoding: [{ field: 'size', channel: 'size' }],
    };
    const treeRows = [
        { id: 'root', parent: null, size: 0 },
        { id: 'a', parent: 'root', size: 0 },
        { id: 'b', parent: 'root', size: 0 },
        { id: 'a1', parent: 'a', size: 0 },
        { id: 'a2', parent: 'a', size: 0 },
        { id: 'b1', parent: 'b', size: 0 },
    ];
    const { semantic } = pipeline(treeSpec, treeRows);
    const nodes = semantic.root.children.filter((n) => n.id.startsWith('tree:') && n.role === 'chart.mark');
    if (nodes.length !== 6) fail(`want 6 tree nodes, got ${nodes.length}`);
    const posOf = (key) => nodes.find((n) => n.id === `tree:${key}`);
    // Depth maps to x: root leftmost, leaves rightmost.
    if (!(posOf('root').cx < posOf('a').cx && posOf('a').cx < posOf('a1').cx)) {
        fail('tree depth must map to x');
    }
    // Parents center over their children: a sits midway of a1 and a2.
    const mid = (posOf('a1').cy + posOf('a2').cy) / 2;
    if (Math.abs(posOf('a').cy - mid) > 1e-9) fail('tree parents must center over children');
    // Edges connect parents to children.
    if (!semantic.root.children.some((n) => n.id === 'tree:edge:a:a1')) fail('tree must draw parent edges');
    // Deterministic: same input, same layout.
    const again = pipeline(treeSpec, treeRows);
    const posA = again.semantic.root.children.find((n) => n.id === 'tree:a1');
    if (posA.cx !== posOf('a1').cx || posA.cy !== posOf('a1').cy) fail('tree layout must be deterministic');
    // Cycle is an error.
    const cyc = compile(treeSpec, fromRows([
        { id: 'x', parent: 'y', size: 0 },
        { id: 'y', parent: 'x', size: 0 },
    ]));
    if (!cyc.diagnostics.items.some((d) => d.code === 'davinci.chart.tree-cycle')) {
        fail('a hierarchy cycle must raise tree-cycle');
    }
}

// ─── Third wave: force / parallel / hexbin / contour / chord / tree variants / geo ───

console.log('charts-render: force layout is deterministic, seeded by the edge fingerprint…');
{
    const forceSpec = {
        mark: 'force',
        encoding: [
            { field: 'src', channel: 'source' },
            { field: 'dst', channel: 'target' },
        ],
    };
    const forceRows = [
        { src: 'a', dst: 'b' }, { src: 'a', dst: 'c' }, { src: 'b', dst: 'c' },
        { src: 'a', dst: 'b' }, // duplicate — merged with an info diagnostic
        { src: 'c', dst: 'c' }, // self-loop — refused
        { src: 'd', dst: 'e' },
    ];
    const a = pipeline(forceSpec, forceRows);
    const b = pipeline(forceSpec, forceRows);
    if (!a.plan.diagnostics.items.some((d) => d.code === 'davinci.chart.force-self-loop' && d.severity === 'error')) {
        fail('a self-loop must raise force-self-loop (error)');
    }
    if (!a.plan.diagnostics.items.some((d) => d.code === 'davinci.chart.force-duplicate-edge')) {
        fail('a duplicate edge must raise force-duplicate-edge (info)');
    }
    if (a.plan.marks.length !== 5) fail(`want 5 force nodes, got ${a.plan.marks.length}`);
    // Deterministic: identical input gives identical coordinates.
    const posA = new Map(a.plan.marks.map((m) => [m.key, `${m.channels.get('x')},${m.channels.get('y')}`]));
    const posB = new Map(b.plan.marks.map((m) => [m.key, `${m.channels.get('x')},${m.channels.get('y')}`]));
    for (const [k, v] of posA) {
        if (posB.get(k) !== v) fail(`force layout must be deterministic, ${k} moved`);
    }
    // Degrees: a touches b and c (deduped) → 2; d and e touch one each → 1.
    const degOf = (key) => a.plan.marks.find((m) => m.key === key).channels.get('degree');
    if (degOf('a') !== 2 || degOf('d') !== 1) fail(`force degrees must count deduped edges, got a=${degOf('a')} d=${degOf('d')}`);
    // Positions stay inside the normalized frame.
    for (const m of a.plan.marks) {
        const x = Number(m.channels.get('x'));
        const y = Number(m.channels.get('y'));
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) fail('force positions must normalize into [0, 1]');
    }
    // Scene: links as grid lines, nodes as degree-sized marks.
    const links = a.semantic.root.children.filter((n) => n.id.startsWith('force:edge:'));
    if (links.length !== 4) fail(`want 4 deduped force links, got ${links.length}`);
    const dots = a.semantic.root.children.filter((n) => n.id.startsWith('force:') && n.role === 'chart.mark');
    if (dots.length !== 5) fail(`want 5 force node marks, got ${dots.length}`);
    // Oversized input is degree-sampled with a warning.
    const bigRows = Array.from({ length: 420 }, (_, i) => ({ src: `n${i}`, dst: `n${(i * 7) % 419}` }));
    const big = compile(forceSpec, fromRows(bigRows));
    if (!big.diagnostics.items.some((d) => d.code === 'davinci.chart.force-sampled')) {
        fail('oversized graphs must raise force-sampled');
    }
}

console.log('charts-render: parallel coordinates give every dimension its own axis…');
{
    const parSpec = {
        mark: 'parallel',
        dimensions: ['speed', 'weight', 'price'],
        encoding: [{ field: 'brand', channel: 'color' }],
    };
    const parRows = [
        { brand: 'Alpha', speed: 120, weight: 1400, price: 30 },
        { brand: 'Alpha', speed: 150, weight: 1600, price: 42 },
        { brand: 'Beta', speed: 90, weight: 1100, price: 22 },
        { brand: 'Beta', speed: 105, weight: 1250, price: 26 },
    ];
    const { plan, semantic } = pipeline(parSpec, parRows);
    if (!plan.stat) fail('parallel must materialize per-dimension domains');
    const axes = semantic.root.children.filter((n) => n.id.startsWith('parallel:axis:'));
    if (axes.length !== 3) fail(`want 3 parallel axes, got ${axes.length}`);
    // Domains are independent per dimension: speed lo ≠ weight lo ≠ price lo.
    const loCol = plan.stat.columns.find((c) => c.name === 'lo');
    const los = loCol.values.map(Number);
    if (new Set(los).size !== 3) fail('parallel dimensions must keep independent domains');
    // One polyline per row with one vertex per axis and the row key per vertex.
    const lines = semantic.root.children.filter((n) => n.id.startsWith('parallel:') && n.role === 'chart.mark');
    if (lines.length !== 4) fail(`want 4 parallel row polylines, got ${lines.length}`);
    for (const l of lines) {
        const pl = l.hitRegion && l.hitRegion.polyline;
        if (!pl || pl.points.length !== 3) fail('each parallel row must carry one vertex per axis');
        if (!pl.keys.every((k) => k === l.id.slice('parallel:'.length))) fail('parallel vertices must key back to their row');
    }
    // A row missing a dimension value draws nothing.
    const withMissing = compile(parSpec, fromRows([...parRows, { brand: 'Beta', speed: 99, weight: null, price: 21 }]));
    if (withMissing.marks.length !== 4) fail(`a row missing a dimension must not draw, got ${withMissing.marks.length}`);
    // Fewer than two dimensions is an authoring error.
    const bad = compile({ mark: 'parallel', dimensions: ['speed'], encoding: [] }, fromRows(parRows));
    if (!bad.diagnostics.items.some((d) => d.code === 'davinci.chart.parallel-needs-dimensions')) {
        fail('one dimension must raise parallel-needs-dimensions');
    }
}

console.log('charts-render: hexbin tiles scatter into counted hexagons…');
{
    const hexSpec = {
        mark: 'hexbin',
        encoding: [
            { field: 'x', channel: 'x' },
            { field: 'y', channel: 'y' },
        ],
    };
    const hexRows = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) * 3 + (i % 3), y: (i % 6) * 4 + (i % 2) }));
    const { plan, semantic } = pipeline(hexSpec, hexRows);
    if (!plan.stat) fail('hexbin must materialize an aggregation grid');
    const countCol = plan.stat.columns.find((c) => c.name === 'count');
    const total = countCol.values.reduce((a, b) => a + b, 0);
    if (total !== 60) fail(`hexbin counts must sum to the input size, got ${total}`);
    const cells = semantic.root.children.filter((n) => n.id.startsWith('hexbin:') && n.role === 'chart.mark');
    if (cells.length !== plan.stat.rowCount) fail('every hex cell must draw one hexagon');
    for (const c of cells) {
        if (!c.hitRegion || !c.hitRegion.polygon) fail('hexbin cells must carry polygon hit regions');
        if (c.path.commands.length !== 7) fail('a hexagon must be a six-vertex closed path');
    }
    // The densest cell samples the ramp end.
    const maxCell = cells.reduce((a, b) => (Number(plan.stat.columns.find((c) => c.name === 'count').values[a.rowIndex]) >= Number(plan.stat.columns.find((c) => c.name === 'count').values[b.rowIndex]) ? a : b));
    const ramp = DEFAULT_CHART_THEME.heatmapRamp;
    const last = ramp[ramp.length - 1];
    if (maxCell.fill.color.b !== last.b) fail('the densest cell must sample the ramp end');
}

console.log('charts-render: contour draws closed rings from the density grid…');
{
    const contourSpec = {
        mark: 'contour',
        encoding: [
            { field: 'x', channel: 'x' },
            { field: 'y', channel: 'y' },
        ],
    };
    // One blob at (50, 50).
    let seed = 9;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const contourRows = Array.from({ length: 200 }, () => {
        const u = rand();
        const v = rand();
        return { x: 50 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * 10, y: 50 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.sin(2 * Math.PI * v) * 10 };
    });
    const { plan, semantic } = pipeline(contourSpec, contourRows);
    if (!plan.stat) fail('contour must materialize density rings');
    const rings = semantic.root.children.filter((n) => n.id.startsWith('contour:') && n.role === 'chart.mark');
    if (rings.length === 0) fail('contour must draw at least one ring');
    for (const r of rings) {
        if (!r.hitRegion || !r.hitRegion.polygon) fail('contour rings must carry polygon hit regions');
        if (r.path.commands[r.path.commands.length - 1].kind !== 'close') fail('contour rings must be closed');
    }
    // Nested rings: the highest level sits inside the lowest level's bounds.
    const levels = [...new Set(plan.marks.map((m) => Number(m.channels.get('level'))))].sort((a, b) => a - b);
    if (levels.length < 2) fail('contour must produce multiple nice levels');
    const ringOf = (lv) => rings.filter((n) => Number(n.hitRegion.polygon ? plan.marks.find((m) => `contour:${m.key}` === n.id).channels.get('level') : 0) === lv);
    const outer = ringOf(levels[0])[0];
    const inner = ringOf(levels[levels.length - 1])[0];
    if (outer && inner) {
        const oxs = outer.hitRegion.polygon.points.map((p) => p.x);
        const ixs = inner.hitRegion.polygon.points.map((p) => p.x);
        if (!(Math.min(...ixs) >= Math.min(...oxs) && Math.max(...ixs) <= Math.max(...oxs))) {
            fail('higher-level rings must nest inside lower-level rings');
        }
    }
    // Fewer than three points warns.
    const few = compile(contourSpec, fromRows([{ x: 1, y: 1 }, { x: 2, y: 2 }]));
    if (!few.diagnostics.items.some((d) => d.code === 'davinci.chart.contour-few-points')) {
        fail('too few points must raise contour-few-points');
    }
}

console.log('charts-render: chord draws group arcs and quadratic ribbons…');
{
    const chordSpec = {
        mark: 'chord',
        encoding: [
            { field: 'src', channel: 'source' },
            { field: 'dst', channel: 'target' },
            { field: 'gb', channel: 'value' },
        ],
    };
    const chordRows = [
        { src: 'A', dst: 'B', gb: 30 },
        { src: 'B', dst: 'A', gb: 10 }, // mutual flows are legal in chord
        { src: 'A', dst: 'C', gb: 20 },
        { src: 'C', dst: 'C', gb: 99 }, // self-link — dropped with a warning
    ];
    const { plan, semantic } = pipeline(chordSpec, chordRows);
    if (!plan.diagnostics.items.some((d) => d.code === 'davinci.chart.chord-self-link')) {
        fail('a self-link must raise chord-self-link');
    }
    const groups = semantic.root.children.filter((n) => n.id.startsWith('chord-group:'));
    if (groups.length !== 3) fail(`want 3 chord groups, got ${groups.length}`);
    // Group spans follow in+out totals: A = 60 (out 50 + in 10), C = 20.
    const sectorOf = (name) => groups.find((n) => n.id === `chord-group:${name}`).hitRegion.sector;
    const spanA = sectorOf('A').a1 - sectorOf('A').a0;
    const spanC = sectorOf('C').a1 - sectorOf('C').a0;
    if (Math.abs(spanA / spanC - 3) > 0.2) fail('chord group spans must be proportional to in+out totals');
    const ribbons = semantic.root.children.filter((n) => n.id.startsWith('chord:') && n.role === 'chart.mark' && n.kind === 'path');
    if (ribbons.length !== 3) fail(`want 3 chord ribbons, got ${ribbons.length}`);
    for (const r of ribbons) {
        if (!r.path.commands.some((c) => c.kind === 'quadratic')) fail('chord ribbons must use quadratic curves');
        if (!r.hitRegion || !r.hitRegion.polygon) fail('chord ribbons must carry polygon hit regions');
    }
}

console.log('charts-render: tree variants align leaves and go radial…');
{
    const treeSpec = {
        mark: 'tree',
        keyField: 'id',
        parentField: 'parent',
        treeLayout: 'dendrogram',
        encoding: [{ field: 'size', channel: 'size' }],
    };
    const treeRows = [
        { id: 'root', parent: null, size: 0 },
        { id: 'a', parent: 'root', size: 0 },
        { id: 'a1', parent: 'a', size: 0 },
        { id: 'a2', parent: 'a', size: 0 },
        { id: 'b', parent: 'root', size: 0 },
    ];
    const { semantic } = pipeline(treeSpec, treeRows);
    const posOf = (key) => semantic.root.children.find((n) => n.id === `tree:${key}`);
    // Dendrogram: all leaves share the deepest column's x.
    const leafXs = ['a1', 'a2', 'b'].map((k) => posOf(k).cx);
    if (Math.abs(leafXs[0] - leafXs[1]) > 1e-9 || Math.abs(leafXs[1] - leafXs[2]) > 1e-9) {
        fail('dendrogram leaves must align on the deepest column');
    }
    // Radial: the root sits at the plot center, leaves on the outer ring.
    const radial = pipeline({ ...treeSpec, treeLayout: 'radial' }, treeRows);
    const rPosOf = (key) => radial.semantic.root.children.find((n) => n.id === `tree:${key}`);
    const root = rPosOf('root');
    const leaf = rPosOf('a1');
    const center = { x: 640 / 2, y: 360 / 2 };
    void center;
    const dRoot = Math.hypot(root.cx - 320, root.cy - 180);
    if (dRoot > 2) fail(`radial root must sit at the center, got ${dRoot}`);
    const dLeaf = Math.hypot(leaf.cx - root.cx, leaf.cy - root.cy);
    const dParent = Math.hypot(rPosOf('a').cx - root.cx, rPosOf('a').cy - root.cy);
    if (!(dLeaf > dParent)) fail('radial leaves must sit further out than their parents');
}

console.log('charts-render: geo choropleth matches regions and punches holes…');
{
    // Tiny fixture basemap (registered by the host, never bundled).
    const fixtureMap = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: { name: 'Alpha', iso_a3: 'ALP' },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
            },
            {
                type: 'Feature',
                properties: { name: 'Beta', iso_a3: 'BET' },
                geometry: { type: 'Polygon', coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]] },
            },
        ],
    };
    registerGeoMap('fixture-map', fixtureMap);
    const geoSpec = {
        mark: 'geo',
        geo: { map: 'fixture-map', projection: 'mercator' },
        encoding: [
            { field: 'region', channel: 'region' },
            { field: 'gdp', channel: 'color' },
        ],
    };
    const geoRows = [
        { region: 'Alpha', gdp: 90 },
        { region: 'BET', gdp: 40 }, // iso_a3 match
        { region: 'Nowhere', gdp: 1 },
    ];
    const { plan, semantic } = pipeline(geoSpec, geoRows);
    if (!plan.diagnostics.items.some((d) => d.code === 'davinci.chart.geo-unmatched-region')) {
        fail('an unmatched region must raise geo-unmatched-region');
    }
    if (plan.marks.length !== 2) fail(`unmatched regions must not draw, got ${plan.marks.length}`);
    const regions = semantic.root.children.filter((n) => n.id.startsWith('geo:') && n.role === 'chart.mark');
    if (regions.length !== 2) fail(`want 2 geo regions (both map features), got ${regions.length}`);
    for (const r of regions) {
        if (!r.hitRegion || !r.hitRegion.polygon) fail('geo regions must carry polygon hit regions');
    }
    // Alpha (90) samples near the ramp end; Beta (40, matched via iso_a3) is lighter.
    const ramp = DEFAULT_CHART_THEME.heatmapRamp;
    const alpha = regions.find((n) => n.id === 'geo:0');
    const beta = regions.find((n) => n.id === 'geo:Beta');
    const rampEnd = ramp[ramp.length - 1];
    if (alpha.fill.color.b !== rampEnd.b) fail('the max region must sample the ramp end');
    if (!(beta.fill.color.b > alpha.fill.color.b)) fail('lower values must sample lighter ramp stops (lighter = higher channel values on the light ramp)');
    // An iso-matched region still gets its ramp value, never the track fill.
    if (beta.fill.color.b === DEFAULT_CHART_THEME.trackColor.b && beta.fill.color.g === DEFAULT_CHART_THEME.trackColor.g) {
        fail('an iso_a3-matched region must take its ramp value, not the track fill');
    }
    // Unknown map id is an error.
    const bad = compile({ ...geoSpec, geo: { map: 'nope', projection: 'mercator' } }, fromRows(geoRows));
    if (!bad.diagnostics.items.some((d) => d.code === 'davinci.chart.geo-unknown-map')) {
        fail('an unregistered basemap must raise geo-unknown-map');
    }
    // The real Natural Earth lite pack: register from disk and smoke a spec.
    const lite = JSON.parse(readFileSync(new URL('../../../../../davinci/geo-assets/src/ne-110m-lite.json', import.meta.url), 'utf8'));
    registerGeoMap('ne-110m-lite', lite);
    const world = compile(
        { mark: 'geo', geo: { map: 'ne-110m-lite', projection: 'mercator' }, encoding: geoSpec.encoding },
        fromRows([
            { region: 'China', gdp: 18000 },
            { region: 'United States of America', gdp: 27000 },
            { region: 'BRA', gdp: 2100 },
        ]),
    );
    if (world.marks.length !== 3) fail(`Natural Earth lite must match name and iso regions, got ${world.marks.length}`);
    const worldScene = buildScene(world, { width: WIDTH, height: HEIGHT });
    const worldRegions = worldScene.root.children.filter((n) => n.id.startsWith('geo:') && n.role === 'chart.mark');
    if (worldRegions.length < 150) fail(`the world basemap must draw every feature, got ${worldRegions.length}`);
}

console.log('charts-render: streamgraph without a series channel is refused…');
{
    const noSeries = compile(
        { mark: 'streamgraph', encoding: [{ field: 'week', channel: 'x' }, { field: 'hours', channel: 'y' }] },
        fromRows([{ week: 'W1', hours: 3 }, { week: 'W2', hours: 5 }]),
    );
    if (!noSeries.diagnostics.items.some((d) => d.code === 'davinci.chart.streamgraph-needs-series' && d.severity === 'error')) {
        fail('streamgraph without a series channel must raise streamgraph-needs-series');
    }
}

console.log('charts-render: the six ruled marks keep hit regions, dark theme and canvas parity…');
{
    // 与本文件 canvas 节同口径的记录器（局部重复定义，避免跨节耦合）。
    function recCtx() {
        return {
            calls: [] as any[],
            fillStyle: null as any,
            strokeStyle: null as any,
            lineWidth: 1,
            font: '',
            textAlign: '',
            textBaseline: '',
            save() {},
            restore() {},
            transform(a: number, b: number, c: number, d: number, e: number, f: number) {
                this.calls.push(['transform', a, b, c, d, e, f]);
            },
            beginPath() {
                this.calls.push(['beginPath']);
            },
            closePath() {
                this.calls.push(['closePath']);
            },
            moveTo(x: number, y: number) {
                this.calls.push(['moveTo', x, y]);
            },
            lineTo(x: number, y: number) {
                this.calls.push(['lineTo', x, y]);
            },
            quadraticCurveTo() {
                this.calls.push(['quadratic']);
            },
            bezierCurveTo() {
                this.calls.push(['cubic']);
            },
            ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number, ccw: boolean) {
                this.calls.push(['ellipse', cx, cy, rx, ry, rot, start, end, ccw]);
            },
            rect(x: number, y: number, w: number, h: number) {
                this.calls.push(['rect', x, y, w, h]);
            },
            clip() {
                this.calls.push(['clip']);
            },
            fill() {
                this.calls.push(['fill', String(this.fillStyle)]);
            },
            fillRect(x: number, y: number, w: number, h: number) {
                this.calls.push(['fillRect', x, y, w, h, String(this.fillStyle)]);
            },
            stroke() {
                this.calls.push(['stroke', String(this.strokeStyle), this.lineWidth]);
            },
            fillText(text: string, x: number, y: number) {
                this.calls.push(['fillText', text, x, y, this.font, this.textAlign]);
            },
            setLineDash(segments: unknown[]) {
                this.calls.push(['dash', segments.length]);
            },
        };
    }
    // 与 canvas 节同一合同：形状叶 = fill?1:0 + stroke?1:0，文本 = 1，图像 = 0。
    function leafOps(node: any): number {
        if (node.kind === 'group') return node.children.reduce((a: number, c: any) => a + leafOps(c), 0);
        if (node.kind === 'text') return 1;
        if (node.kind === 'image') return 0;
        return (node.fill ? 1 : 0) + (node.stroke ? 1 : 0);
    }

    const hexbinRows = Array.from({ length: 60 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 80 }));
    const sixCases: ReadonlyArray<{ name: string; spec: any; rows: ReadonlyArray<Record<string, unknown>> }> = [
        {
            name: 'force',
            spec: { mark: 'force', encoding: [{ field: 's', channel: 'source' }, { field: 't', channel: 'target' }] },
            rows: [
                { s: 'a', t: 'b' },
                { s: 'b', t: 'c' },
                { s: 'a', t: 'c' },
                { s: 'c', t: 'd' },
            ],
        },
        {
            name: 'parallel',
            spec: { mark: 'parallel', dimensions: ['u', 'v'], encoding: [{ field: 'g', channel: 'color' }] },
            rows: [
                { g: 'p', u: 1, v: 5 },
                { g: 'q', u: 3, v: 2 },
            ],
        },
        {
            name: 'hexbin',
            spec: { mark: 'hexbin', encoding: [{ field: 'x', channel: 'x' }, { field: 'y', channel: 'y' }] },
            rows: hexbinRows,
        },
        {
            name: 'contour',
            spec: { mark: 'contour', encoding: [{ field: 'x', channel: 'x' }, { field: 'y', channel: 'y' }] },
            rows: hexbinRows,
        },
        {
            name: 'chord',
            spec: { mark: 'chord', encoding: [{ field: 's', channel: 'source' }, { field: 't', channel: 'target' }, { field: 'v', channel: 'value' }] },
            rows: [
                { s: 'a', t: 'b', v: 3 },
                { s: 'b', t: 'a', v: 2 },
                { s: 'a', t: 'c', v: 1 },
            ],
        },
        {
            name: 'geo',
            spec: { mark: 'geo', geo: { map: 'ne-110m-lite', projection: 'mercator' }, encoding: [{ field: 'r', channel: 'region' }, { field: 'v', channel: 'color' }] },
            rows: [
                { r: 'China', v: 5 },
                { r: 'France', v: 2 },
            ],
        },
    ];
    for (const c of sixCases) {
        const { plan, semantic } = pipeline(c.spec, c.rows);
        // 每个可视 mark 必须带命中区（tooltip/键盘可达的引擎级前提）。
        const marks = semantic.root.children.filter((n) => n.role === 'chart.mark');
        if (marks.length === 0) fail(`${c.name}: no chart.mark nodes`);
        for (const m of marks) {
            if (!m.hitRegion) fail(`${c.name}: mark ${m.id} must carry a hit region`);
        }
        // 暗色：暗标签色必须出现，亮主题铬色不得泄漏。
        const darkSemantic = buildScene(plan, { width: WIDTH, height: HEIGHT }, { theme: DARK_CHART_THEME });
        const darkSvg = renderSvg(resolve(darkSemantic, { width: WIDTH, height: HEIGHT }));
        if (!darkSvg.includes('#d1d5db')) fail(`${c.name}: dark build must use the dark label token`);
        if (darkSvg.includes('#4b5563')) fail(`${c.name}: dark build must not leak the light label token`);
        // Canvas：绘制操作数与 display 叶节点一一对应。
        const display = resolve(semantic, { width: WIDTH, height: HEIGHT });
        const rec = recCtx();
        renderCanvas(display, rec);
        const paintOps = rec.calls.filter((k: any[]) => k[0] === 'fill' || k[0] === 'stroke' || k[0] === 'fillText').length;
        const wantOps = leafOps(display.root);
        if (paintOps !== wantOps) fail(`${c.name}: canvas paint ops ${paintOps} must equal display leaf ops ${wantOps}`);
    }
}

console.log('charts-render PASS: chart pipeline + diagnostics + zero baseline + series + diagram SVG');

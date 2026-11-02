// Chart scene builder — ChartCompilePlan + viewport → SemanticScene.
//
// The compile plan carries scales with a host-independent range (linear stays
// in [0, 1], band uses one step per category). This module is the only place
// that turns those ranges into pixels, so `compile` never guesses a viewport.
// It emits mark geometry plus grid lines, axis baselines, tick labels and a
// legend — no motion or interaction state. Presentation colors and fonts come
// from a `ChartTheme` resolved here, never chosen by the renderer.
//
// Visual hierarchy is a contract: grid lines are the quietest layer, axis
// chrome sits above them, and data marks are the strongest stroke/fill. The
// legend lives above the plot, never on top of data.
//
// Node identity comes from the plan's stable row `key` (bar / point) or the
// series value (line / area), never from the position of an item in a
// temporary array. The plan is also the only source of the series grouping
// domain.

import type { PathCommand, RGBA } from "@doki-land/davinci-types";
import {
    SCENE_VERSION,
    estimateTextSize,
    truncateToWidth,
    type SemanticNode,
    type SemanticScene,
} from "@doki-land/davinci-scene";
import { resolveSeriesLayout, type ChartCompilePlan, type PlanMark } from "./compile.js";
import { column, type DataColumn } from "./data.js";
import { apply, bandwidth, formatTickLabel, niceLinearTicks, type Scale } from "./scale.js";
import { DEFAULT_CHART_THEME, type ChartTheme } from "./theme.js";

/** Plot padding in logical pixels. */
export interface ScenePadding {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/** Viewport the scene is laid out into. */
export interface ChartViewport {
    readonly width: number;
    readonly height: number;
    /** Uniform padding or per-side override. */
    readonly padding?: number | Partial<ScenePadding>;
}

interface PlotRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

interface PositionedMark {
    readonly rowIndex: number;
    /** Stable row identity from the compile plan. */
    readonly key: string;
    readonly x: number;
    readonly y: number;
    /** Raw y value in data units (stack geometry needs it). */
    readonly yRaw: number | null;
    /** Stacked baseline in data units, when the plan carries one. */
    readonly stackBase: number | null;
    readonly series: string | null;
}

const DEFAULT_PADDING = 16;
const LINE_STROKE_WIDTH = 2;
const POINT_RADIUS = 4;
const POINT_STROKE_WIDTH = 1.5;
const BAR_RATIO = 0.72;
const BAR_RADIUS = 2;

const TICK_LENGTH = 4;
const LABEL_GAP = 6;
const LEGEND_SWATCH = 10;
const LEGEND_SWATCH_GAP = 6;
const LEGEND_ITEM_GAP = 16;
const LEGEND_LABEL_BUDGET = 120;
const LEGEND_BOTTOM_GAP = 10;
/** Bubble radius range (sqrt area-proportional size channel). */
const BUBBLE_MIN_R = 3;
const BUBBLE_MAX_R = 16;
/** Legend rows wrap instead of clipping; past the cap the rest become `+N`. */
const LEGEND_MAX_ROWS = 3;
const LEGEND_ROW_GAP = 6;

/** Options for the scene build. */
export interface ChartSceneOptions {
    /** Presentation tokens; defaults to `DEFAULT_CHART_THEME`. */
    readonly theme?: ChartTheme;
}

/** Given a series label, return its palette index (stable across callers). */
function seriesPaletteIndex(categories: ReadonlyArray<string>, series: string): number {
    const idx = categories.indexOf(series);
    return idx < 0 ? 0 : idx;
}

/** Given a series label, return its theme palette color. Falls back to
 *  `theme.markFill` when the chart is ungrouped. */
function seriesColor(theme: ChartTheme, categories: ReadonlyArray<string> | undefined, series: string | null): RGBA {
    if (!categories || categories.length === 0 || series === null) return theme.markFill;
    const palette = theme.seriesPalette;
    if (palette.length === 0) return theme.markFill;
    return palette[seriesPaletteIndex(categories, series) % palette.length];
}

function axisStroke(theme: ChartTheme): { color: RGBA; width: number } {
    return { color: theme.axisStroke, width: theme.axisStrokeWidth };
}

/** Build a SemanticScene from a ChartCompilePlan and a pixel viewport. */
export function buildScene(plan: ChartCompilePlan, viewport: ChartViewport, options?: ChartSceneOptions): SemanticScene {
    const theme = options?.theme ?? DEFAULT_CHART_THEME;
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    const seriesCategories = plan.series.field !== null ? plan.series.categories : undefined;
    const spark = plan.spec.spark === true;

    // The legend reserves its own strip above the plot, so it can never
    // cover data. Base padding (from axis labels) fixes the plot width, the
    // legend wraps into rows against that width once, and its strip height
    // feeds the top padding before the final plot rect is computed. Sparkline
    // mode strips all furniture: no axes, no grid, no legend, tight padding.
    let basePadding = spark
        ? { top: 6, right: 6, bottom: 6, left: 6 }
        : adaptivePadding(viewport, plan, xEnc, yEnc, theme);
    // Bullet rows label their categories at the left edge — reserve room for
    // the longest label (capped), or every row reads as an ellipsis.
    if (plan.spec.mark === "bullet" && !spark) {
        const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
        const xCol = xEnc ? column(plan.resolvedData, xEnc.field) : undefined;
        if (xCol) {
            let longest = 0;
            for (const v of xCol.values) {
                if (v === null || v === undefined) continue;
                const label = truncateToWidth(String(v), 96, theme.labelFont.sizePx);
                longest = Math.max(longest, estimateTextSize(label, theme.labelFont.sizePx).width);
            }
            const needed = longest + LABEL_GAP + 4;
            if (needed > basePadding.left) basePadding = { ...basePadding, left: needed };
        }
    }
    const legendWidth = Math.max(0, dimension(viewport.width) - basePadding.left - basePadding.right);
    const legendRows =
        !spark && plan.series.field !== null ? layoutLegendRows(plan.series.categories, legendWidth, theme) : [];
    // Heatmap carries no categorical legend, but its gradient ramp strip needs
    // the same headroom above the plot.
    const rampReserve = !spark && plan.spec.mark === "heatmap" ? legendRowHeight(theme) + LEGEND_BOTTOM_GAP : 0;
    const legendHeight =
        (legendRows.length > 0
            ? legendRows.length * legendRowHeight(theme) + (legendRows.length - 1) * LEGEND_ROW_GAP + LEGEND_BOTTOM_GAP
            : 0) + rampReserve;
    const padding: ScenePadding = { ...basePadding, top: basePadding.top + legendHeight };
    const plot = plotRect(viewport, padding);

    const frame = (children: SemanticNode[]): SemanticScene => ({
        version: SCENE_VERSION,
        root: {
            kind: "group",
            id: "chart-root",
            role: "group",
            children,
        },
    });

    // Marks with their own frame (no cartesian axes). Everything else —
    // identity, legend, theme — is shared through the same helpers.
    const ownFrame = plan.spec.mark !== "pie" && plan.spec.mark !== "radar" && markOwnFrame(plan.spec.mark);
    if (plan.spec.mark === "pie" || plan.spec.mark === "radar" || ownFrame) {
        const children: SemanticNode[] = [];
        if (plot.w > 0 && plot.h > 0) {
            children.push(...buildMarkPanel(plan, plot, seriesCategories, theme, ""));
            children.push(...buildLegend(plan, plot, legendRows, theme));
        }
        return frame(children);
    }

    // Facets split the plot into a small-multiple grid: one panel per facet
    // value with shared scales, and the legend stays global.
    if (plan.spec.facetField) {
        return frame([...buildFacets(plan, plot, seriesCategories, theme), ...buildLegend(plan, plot, legendRows, theme)]);
    }

    const children: SemanticNode[] = [];
    if (xEnc && plot.w > 0 && plot.h > 0) {
        children.push(...buildCartesianPanel(plan, plot, seriesCategories, theme, ""));
        children.push(...buildLegend(plan, plot, legendRows, theme));
    }
    return frame(children);
}

/** Marks that own their frame instead of the cartesian grid. */
function markOwnFrame(mark: string): boolean {
    switch (mark) {
        case "heatmap":
        case "gauge":
        case "rose":
        case "radial-bar":
        case "treemap":
        case "sankey":
        case "funnel":
        case "ridgeline":
        case "bullet":
        case "boxplot":
            return true;
        default:
            return false;
    }
}

/** Route one mark kind to its panel builder — shared by the root frame and
 *  facet cells so small multiples reuse the same geometry. */
function buildMarkPanel(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    switch (plan.spec.mark) {
        case "pie":
            return buildPie(plan, plot, seriesCategories, theme);
        case "radar":
            return buildRadar(plan, plot, seriesCategories, theme, idPrefix);
        case "heatmap":
            return buildHeatmap(plan, plot, theme, idPrefix);
        case "gauge":
            return buildGauge(plan, plot, theme, idPrefix);
        case "rose":
            return buildRose(plan, plot, seriesCategories, theme, idPrefix);
        case "radial-bar":
            return buildRadialBar(plan, plot, seriesCategories, theme, idPrefix);
        case "treemap":
            return buildTreemap(plan, plot, theme, idPrefix);
        case "sankey":
            return buildSankey(plan, plot, theme, idPrefix);
        case "funnel":
            return buildFunnel(plan, plot, seriesCategories, theme, idPrefix);
        case "ridgeline":
            return buildRidgeline(plan, plot, seriesCategories, theme, idPrefix);
        case "bullet":
            return buildBullet(plan, plot, theme, idPrefix);
        case "boxplot":
            return buildBoxplot(plan, plot, theme, idPrefix);
        default:
            return buildCartesianPanel(plan, plot, seriesCategories, theme, idPrefix);
    }
}

/** One cartesian panel: grid + axes + marks inside an already-computed plot
 *  rect. `idPrefix` qualifies furniture and series-level ids so faceted
 *  panels never collide; row-level mark ids stay key-stable. */
function buildCartesianPanel(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    if (!xEnc || plot.w <= 0 || plot.h <= 0) return [];
    const xScale = pixelScale(plan.scales.get(xEnc.channel), [plot.x, plot.x + plot.w]);
    // Marks without a y encoding (histogram, candlestick) still install a
    // synthetic y scale at compile time, so the frame stays shared.
    const yScale = pixelScale(plan.scales.get(yEnc?.channel ?? "y"), [plot.y + plot.h, plot.y]);
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = yEnc ? column(plan.resolvedData, yEnc.field) : undefined;
    if (!xScale || !yScale || !xCol) return [];
    const rows = positionedRows(plan, xScale, yScale, xCol, yCol);
    const spark = plan.spec.spark === true;
    return [
        ...(spark ? [] : buildGrid(plot, yScale, theme, idPrefix)),
        ...(spark ? [] : [buildAxis(`${idPrefix}x-axis`, plot, xScale, "horizontal", theme)]),
        ...(spark ? [] : [buildAxis(`${idPrefix}y-axis`, plot, yScale, "vertical", theme)]),
        ...buildMarks(plan, rows, plot, xScale, yScale, seriesCategories, theme, idPrefix),
        ...buildErrorBars(plan, rows, xScale, yScale, theme, idPrefix),
    ];
}

/** Compute per-side padding that fits tick labels for both axes. */
function adaptivePadding(
    viewport: ChartViewport,
    plan: ChartCompilePlan,
    xEnc: { field: string; channel: string } | undefined,
    yEnc: { field: string; channel: string } | undefined,
    theme: ChartTheme,
): ScenePadding {
    const userOverride = viewport.padding;
    const base =
        typeof userOverride === "number" && Number.isFinite(userOverride)
            ? { top: userOverride, right: userOverride, bottom: userOverride, left: userOverride }
            : typeof userOverride === "object" && userOverride
              ? {
                    top: userOverride.top ?? DEFAULT_PADDING,
                    right: userOverride.right ?? DEFAULT_PADDING,
                    bottom: userOverride.bottom ?? DEFAULT_PADDING,
                    left: userOverride.left ?? DEFAULT_PADDING,
                }
              : { top: DEFAULT_PADDING, right: DEFAULT_PADDING, bottom: DEFAULT_PADDING, left: DEFAULT_PADDING };

    let left = base.left;
    let bottom = base.bottom;

    // Y-axis labels → expand left padding so tick labels aren't clipped.
    const yScale = yEnc ? plan.scales.get(yEnc.channel) : undefined;
    if (yScale) {
        const ticks = axisTickLabels(yScale);
        const maxWidth = ticks.reduce(
            (acc, label) => Math.max(acc, estimateTextSize(label, theme.labelFont.sizePx).width),
            0,
        );
        const needed = TICK_LENGTH + LABEL_GAP + maxWidth + 2; // +2 safety
        if (needed > left) left = needed;
    }
    // X-axis labels → expand bottom padding similarly.
    const xScale = xEnc ? plan.scales.get(xEnc.channel) : undefined;
    if (xScale) {
        const ticks = axisTickLabels(xScale);
        const maxHeight = ticks.reduce(
            (acc, label) => Math.max(acc, estimateTextSize(label, theme.labelFont.sizePx).height),
            0,
        );
        const needed = TICK_LENGTH + LABEL_GAP + maxHeight + 2;
        if (needed > bottom) bottom = needed;
    }
    return { top: base.top, right: base.right, bottom, left };
}

function positionedRows(
    plan: ChartCompilePlan,
    xScale: Scale,
    yScale: Scale,
    xCol: DataColumn,
    yCol: DataColumn | undefined,
): ReadonlyArray<PositionedMark> {
    // Without a y encoding (histogram, candlestick) rows position by x only;
    // those builders read their own columns / the stat snapshot for heights.
    const rows: PositionedMark[] = [];
    for (const mark of plan.marks) {
        const x = project(xScale, xCol.values[mark.rowIndex] ?? null);
        const y = yCol ? project(yScale, yCol.values[mark.rowIndex] ?? null) : 0;
        if (yCol && (!Number.isFinite(x) || !Number.isFinite(y))) continue;
        const rawY = yCol ? (yCol.values[mark.rowIndex] ?? null) : null;
        rows.push({
            rowIndex: mark.rowIndex,
            key: mark.key,
            x,
            y,
            yRaw: typeof rawY === "number" && Number.isFinite(rawY) ? rawY : null,
            stackBase: mark.stackBase ?? null,
            series: mark.series,
        });
    }
    return rows;
}

function buildMarks(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string = "",
): SemanticNode[] {
    const layout = resolveSeriesLayout(plan.spec, seriesCategories !== undefined);
    switch (plan.spec.mark) {
        case "bar":
        case "rect":
            return buildBars(plan, rows, plot, xScale, yScale, seriesCategories, theme, layout);
        case "waterfall":
            return buildWaterfall(plan, rows, plot, xScale, yScale, seriesCategories, theme, layout);
        case "line":
            return buildLines(rows, seriesCategories, theme, idPrefix);
        case "area":
            return buildAreas(rows, plot, yScale, seriesCategories, theme, layout, idPrefix);
        case "point":
        case "circle":
            return buildPoints(plan, rows, seriesCategories, theme);
        case "histogram":
            return buildHistogramBars(plan, plot, xScale, yScale, theme);
        case "candlestick":
            return buildCandlesticks(plan, rows, plot, xScale, yScale, theme);
        case "bump":
            return buildBump(plan, rows, plot, yScale, seriesCategories, theme, idPrefix);
        case "slope":
            return buildSlope(plan, rows, seriesCategories, theme, idPrefix);
        default:
            // `compile` rejects unimplemented marks with
            // `davinci.chart.unsupported-mark`, so reaching this branch means
            // the plan was hand-built outside the contract. Silence would
            // render an empty chart with no explanation; refuse loudly.
            throw new Error(`davinci.chart.unsupported-mark: scene builder has no geometry for mark "${String(plan.spec.mark)}"`);
    }
}

/** Error-bar I-beams for bar / line / point charts with `yError`,
 *  `yErrorMinus` / `yErrorPlus` channels. Decorative: hit-testing and
 *  keyboard navigation stay on the parent marks. */
function buildErrorBars(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    xScale: Scale,
    yScale: Scale,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const symEnc = plan.spec.encoding.find((e) => e.channel === "yError");
    const minusEnc = plan.spec.encoding.find((e) => e.channel === "yErrorMinus");
    const plusEnc = plan.spec.encoding.find((e) => e.channel === "yErrorPlus");
    if (!symEnc && !minusEnc && !plusEnc) return [];
    const symCol = symEnc ? column(plan.resolvedData, symEnc.field) : undefined;
    const minusCol = minusEnc ? column(plan.resolvedData, minusEnc.field) : undefined;
    const plusCol = plusEnc ? column(plan.resolvedData, plusEnc.field) : undefined;
    const CAP = 4;
    const nodes: SemanticNode[] = [];
    for (const row of rows) {
        if (row.yRaw === null) continue;
        const read = (col: DataColumn | undefined): number => {
            if (!col) return NaN;
            const v = col.values[row.rowIndex];
            return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN;
        };
        const sym = read(symCol);
        const minus = read(minusCol);
        const plus = read(plusCol);
        const lo = row.yRaw - (Number.isFinite(minus) ? minus : Number.isFinite(sym) ? sym : 0);
        const hi = row.yRaw + (Number.isFinite(plus) ? plus : Number.isFinite(sym) ? sym : 0);
        if (hi === row.yRaw && lo === row.yRaw) continue;
        const yTop = project(yScale, hi);
        const yBot = project(yScale, lo);
        if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
        const x = row.x;
        nodes.push({
            kind: "path",
            id: `${idPrefix}err:${row.key}`,
            role: "decorative",
            path: {
                commands: [
                    { kind: "move", to: { x, y: yTop } },
                    { kind: "line", to: { x, y: yBot } },
                    { kind: "move", to: { x: x - CAP, y: yTop } },
                    { kind: "line", to: { x: x + CAP, y: yTop } },
                    { kind: "move", to: { x: x - CAP, y: yBot } },
                    { kind: "line", to: { x: x + CAP, y: yBot } },
                ],
            },
            stroke: { color: theme.axisStroke, width: 1.5 },
        });
    }
    return nodes;
}

function buildBars(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    layout: "overlap" | "stack" | "dodge",
): SemanticNode[] {
    const bandWidth = xScale.kind === "band" ? bandwidth(xScale) : 0;
    const step = bandWidth > 0 ? bandWidth : plot.w / Math.max(1, rows.length);
    // Rounded caps read well on positive bars; skip the radius when the bar
    // is shorter than the radius or hangs below zero (it would invert).
    const radius = (h: number): number => (h >= BAR_RADIUS * 2 ? BAR_RADIUS : 0);

    return rows.map((row) => {
        const waterfall = plan.spec.mark === "waterfall";
        let x = row.x;
        let yTop = row.y;
        let yBottom = zeroBaseline(yScale, plot);

        if ((layout === "stack" || waterfall) && row.stackBase !== null && row.yRaw !== null) {
            // Stacked / waterfall: span from the cumulative base to base +
            // value. The y scale domain already covers the cumulative extent.
            const a = project(yScale, row.stackBase);
            const b = project(yScale, row.stackBase + row.yRaw);
            yTop = Math.min(a, b);
            yBottom = Math.max(a, b);
        }

        let w = step * BAR_RATIO;
        if (layout === "dodge" && seriesCategories && seriesCategories.length > 0 && row.series !== null) {
            // Dodged: subdivide the band slot into one sub-slot per series in
            // first-appearance order, so a group of n bars fills the slot.
            const n = seriesCategories.length;
            const subWidth = (step * BAR_RATIO) / n;
            const subIndex = seriesPaletteIndex(seriesCategories, row.series);
            x = row.x - (step * BAR_RATIO) / 2 + subIndex * subWidth + subWidth / 2;
            w = subWidth;
        }

        const h = Math.abs(yBottom - yTop);
        return {
            kind: "rect" as const,
            id: `${plan.spec.mark}:${row.key}`,
            role: "chart.mark" as const,
            source: { domain: "chart", path: ["mark", row.key] },
            x: x - w / 2,
            y: Math.min(yTop, yBottom),
            w,
            h,
            rx: layout === "stack" || waterfall ? 0 : radius(h),
            ry: layout === "stack" || waterfall ? 0 : radius(h),
            fill: {
                color: waterfall
                    ? row.yRaw !== null && row.yRaw >= 0
                        ? theme.upColor
                        : theme.downColor
                    : seriesColor(theme, seriesCategories, row.series),
            },
        };
    });
}

/** Waterfall: floating delta bars plus dashed connectors that carry the eye
 *  from each bar's end level to the next bar's base. */
function buildWaterfall(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    layout: "overlap" | "stack" | "dodge",
): SemanticNode[] {
    const bars = buildBars(plan, rows, plot, xScale, yScale, seriesCategories, theme, layout);
    const step = xScale.kind === "band" ? bandwidth(xScale) : plot.w / Math.max(1, rows.length);
    const w = step * BAR_RATIO;
    const connectors: SemanticNode[] = [];
    for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        if (cur.stackBase === null) continue;
        const y = project(yScale, cur.stackBase);
        if (!Number.isFinite(y)) continue;
        connectors.push({
            kind: "path",
            id: `waterfall:link:${i}`,
            role: "chart.grid",
            path: {
                commands: [
                    { kind: "move", to: { x: prev.x + w / 2, y } },
                    { kind: "line", to: { x: cur.x - w / 2, y } },
                ],
            },
            stroke: { color: theme.axisStroke, width: 1, dash: [3, 3] },
        });
    }
    return [...bars, ...connectors];
}

/** Histogram bins as full-width bars from the stat snapshot — no re-binning
 *  in the scene, geometry reads `x0` / `x1` / `count` columns directly. */
function buildHistogramBars(
    plan: ChartCompilePlan,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    theme: ChartTheme,
): SemanticNode[] {
    const stat = plan.stat;
    if (!stat) return [];
    const x0Col = column(stat, "x0");
    const x1Col = column(stat, "x1");
    const countCol = column(stat, "count");
    if (!x0Col || !x1Col || !countCol) return [];
    const baseline = zeroBaseline(yScale, plot);
    const nodes: SemanticNode[] = [];
    for (const mark of plan.marks) {
        const i = mark.rowIndex;
        const px0 = project(xScale, Number(x0Col.values[i]));
        const px1 = project(xScale, Number(x1Col.values[i]));
        const py = project(yScale, Number(countCol.values[i]));
        if (!Number.isFinite(px0) || !Number.isFinite(px1) || !Number.isFinite(py)) continue;
        const w = Math.max(0.5, px1 - px0 - 0.5);
        nodes.push({
            kind: "rect",
            id: `histogram:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            x: px0,
            y: Math.min(py, baseline),
            w,
            h: Math.abs(baseline - py),
            fill: { color: theme.markFill },
        });
    }
    return nodes;
}

/** Candlesticks: body rect + wicks in one path per row, up/down colored. */
function buildCandlesticks(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    theme: ChartTheme,
): SemanticNode[] {
    const enc = (ch: string) => plan.spec.encoding.find((e) => e.channel === ch);
    const oCol = enc("open") ? column(plan.resolvedData, enc("open")!.field) : undefined;
    const hCol = enc("high") ? column(plan.resolvedData, enc("high")!.field) : undefined;
    const lCol = enc("low") ? column(plan.resolvedData, enc("low")!.field) : undefined;
    const cCol = enc("close") ? column(plan.resolvedData, enc("close")!.field) : undefined;
    if (!oCol || !hCol || !lCol || !cCol) return [];
    const num = (col: DataColumn, r: number): number => {
        const v = col.values[r];
        return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    };
    const bandW = xScale.kind === "band" ? bandwidth(xScale) : plot.w / Math.max(1, rows.length);
    const bodyW = Math.max(2, bandW * 0.6);
    const nodes: SemanticNode[] = [];
    for (const row of rows) {
        const r = row.rowIndex;
        const o = num(oCol, r);
        const h = num(hCol, r);
        const l = num(lCol, r);
        const c = num(cCol, r);
        if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
        const up = c >= o;
        const color = up ? theme.upColor : theme.downColor;
        const yO = project(yScale, o);
        const yC = project(yScale, c);
        const yH = project(yScale, h);
        const yL = project(yScale, l);
        const bodyTop = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        const x = row.x;
        nodes.push({
            kind: "path",
            id: `candlestick:${row.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", row.key] },
            path: {
                commands: [
                    { kind: "move", to: { x: x - bodyW / 2, y: bodyTop } },
                    { kind: "line", to: { x: x + bodyW / 2, y: bodyTop } },
                    { kind: "line", to: { x: x + bodyW / 2, y: bodyTop + bodyH } },
                    { kind: "line", to: { x: x - bodyW / 2, y: bodyTop + bodyH } },
                    { kind: "close" },
                    { kind: "move", to: { x, y: yH } },
                    { kind: "line", to: { x, y: bodyTop } },
                    { kind: "move", to: { x, y: bodyTop + bodyH } },
                    { kind: "line", to: { x, y: yL } },
                ],
            },
            fill: { color },
            stroke: { color, width: 1 },
            hitRegion: { rect: { x: x - bodyW / 2, y: Math.min(yH, yL), w: bodyW, h: Math.abs(yL - yH) } },
        });
    }
    return nodes;
}

/** Bump chart: series lines over competition ranks (rank 1 at the top). */
function buildBump(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const rankOf = new Map<string, number>();
    for (const m of plan.marks) {
        const rank = m.channels.get("rank");
        if (typeof rank === "number") rankOf.set(m.key, rank);
    }
    const nodes: SemanticNode[] = [];
    for (const [name, rowsInSeries] of groupBySeries(rows)) {
        const pts = rowsInSeries
            .map((row) => ({ row, rank: rankOf.get(row.key) }))
            .filter((p): p is { row: PositionedMark; rank: number } => typeof p.rank === "number");
        if (pts.length === 0) continue;
        pts.sort((a, b) => a.row.x - b.row.x || a.row.rowIndex - b.row.rowIndex);
        const points = pts.map((p) => ({ x: p.row.x, y: project(yScale, p.rank) }));
        const color = seriesColor(theme, seriesCategories, name);
        nodes.push({
            kind: "path",
            id: `${idPrefix}bump-series:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", name] },
            path: { commands: [{ kind: "move", to: points[0] }, ...points.slice(1).map((p) => ({ kind: "line" as const, to: p }))] },
            hitRegion: { polyline: { points, keys: pts.map((p) => p.row.key) } },
            stroke: { color, width: LINE_STROKE_WIDTH },
        });
        pts.forEach((p, i) => {
            nodes.push({
                kind: "ellipse",
                id: `bump:${p.row.key}`,
                role: "chart.mark",
                source: { domain: "chart", path: ["mark", p.row.key] },
                cx: points[i].x,
                cy: points[i].y,
                rx: POINT_RADIUS,
                ry: POINT_RADIUS,
                fill: { color },
                ...(theme.pointStroke ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } } : {}),
            });
        });
    }
    return nodes;
}

/** Slope chart: one segment per series between exactly two x positions,
 *  endpoint dots and value labels on the outer sides. */
function buildSlope(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    for (const [name, rowsInSeries] of groupBySeries(rows)) {
        const sorted = [...rowsInSeries].sort((a, b) => a.x - b.x || a.rowIndex - b.rowIndex);
        if (sorted.length !== 2) continue;
        const [a, b] = sorted;
        const color = seriesColor(theme, seriesCategories, name);
        nodes.push({
            kind: "path",
            id: `${idPrefix}slope-series:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", name] },
            path: {
                commands: [
                    { kind: "move", to: { x: a.x, y: a.y } },
                    { kind: "line", to: { x: b.x, y: b.y } },
                ],
            },
            hitRegion: { polyline: { points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], keys: [a.key, b.key] } },
            stroke: { color, width: LINE_STROKE_WIDTH },
        });
        for (const [pt, side] of [
            [a, -1],
            [b, 1],
        ] as const) {
            nodes.push({
                kind: "ellipse",
                id: `slope:${pt.key}`,
                role: "chart.mark",
                source: { domain: "chart", path: ["mark", pt.key] },
                cx: pt.x,
                cy: pt.y,
                rx: RADAR_VERTEX_RADIUS,
                ry: RADAR_VERTEX_RADIUS,
                fill: { color },
                ...(theme.pointStroke ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } } : {}),
            });
            const label = pt.yRaw !== null ? formatTickLabel(pt.yRaw, 2) : "";
            if (label !== "") {
                const w = estimateTextSize(label, theme.labelFont.sizePx).width;
                nodes.push({
                    kind: "text",
                    id: `${idPrefix}slope:label:${pt.key}`,
                    role: "chart.axis",
                    text: label,
                    font: theme.labelFont,
                    anchor: { x: pt.x + side * (w / 2 + 6), y: pt.y },
                    color: theme.labelColor,
                });
            }
        }
    }
    return nodes;
}

/** Pixel y of data value 0, clamped to the plot (log scales have no zero). */
function zeroBaseline(yScale: Scale, plot: PlotRect): number {
    const top = plot.y;
    const bottom = plot.y + plot.h;
    if (yScale.kind === "log") return bottom;
    const y = project(yScale, 0);
    if (!Number.isFinite(y)) return bottom;
    return Math.min(bottom, Math.max(top, y));
}

/** Group positioned rows by series, preserving first-appearance order. */
function groupBySeries(rows: ReadonlyArray<PositionedMark>): Map<string, PositionedMark[]> {
    const series = new Map<string, PositionedMark[]>();
    for (const row of rows) {
        const key = row.series ?? "series";
        const bucket = series.get(key);
        if (bucket) bucket.push(row);
        else series.set(key, [row]);
    }
    return series;
}

function buildLines(
    rows: ReadonlyArray<PositionedMark>,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string = "",
): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    for (const [name, rowsInSeries] of groupBySeries(rows)) {
        const sorted = [...rowsInSeries].sort((a, b) => a.x - b.x || a.rowIndex - b.rowIndex);
        const commands: PathCommand[] = [
            { kind: "move", to: { x: sorted[0].x, y: sorted[0].y } },
            ...sorted.slice(1).map((row): PathCommand => ({ kind: "line", to: { x: row.x, y: row.y } })),
        ];
        nodes.push({
            kind: "path",
            id: `${idPrefix}line:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", name] },
            path: { commands },
            // Hosts snap to real data points: vertices in path order, each
            // with its stable row key.
            hitRegion: {
                polyline: {
                    points: sorted.map((row) => ({ x: row.x, y: row.y })),
                    keys: sorted.map((row) => row.key),
                },
            },
            stroke: { color: seriesColor(theme, seriesCategories, name), width: LINE_STROKE_WIDTH },
        });
    }
    return nodes;
}

function buildAreas(
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    layout: "overlap" | "stack" | "dodge",
    idPrefix: string = "",
): SemanticNode[] {
    const baseline = zeroBaseline(yScale, plot);
    const nodes: SemanticNode[] = [];
    for (const [name, rowsInSeries] of groupBySeries(rows)) {
        const sorted = [...rowsInSeries].sort((a, b) => a.x - b.x || a.rowIndex - b.rowIndex);
        const color = seriesColor(theme, seriesCategories, name);
        let commands: PathCommand[];
        if (layout === "stack") {
            // Stacked area: top edge follows base + value, the closing edge
            // walks the cumulative base back — a ribbon, not a zero drop.
            const top = sorted.map((row): PathCommand => {
                const base = row.stackBase ?? 0;
                const value = row.yRaw ?? 0;
                return { kind: "line", to: { x: row.x, y: project(yScale, base + value) } };
            });
            const bottom = [...sorted].reverse().map((row): PathCommand => {
                const base = row.stackBase ?? 0;
                return { kind: "line", to: { x: row.x, y: project(yScale, base) } };
            });
            commands = [{ kind: "move", to: { x: sorted[0].x, y: project(yScale, sorted[0].stackBase ?? 0) } }, ...top, ...bottom, { kind: "close" }];
        } else {
            commands = [
                { kind: "move", to: { x: sorted[0].x, y: baseline } },
                ...sorted.map((row): PathCommand => ({ kind: "line", to: { x: row.x, y: row.y } })),
                { kind: "line", to: { x: sorted[sorted.length - 1].x, y: baseline } },
                { kind: "close" },
            ];
        }
        nodes.push({
            kind: "path",
            id: `${idPrefix}area:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", name] },
            path: { commands },
            // Vertices along the top edge carry row keys, so hosts resolve
            // nearest-point tooltips even for stacked ribbons.
            hitRegion: {
                polyline: {
                    points: sorted.map((row) =>
                        layout === "stack"
                            ? { x: row.x, y: project(yScale, (row.stackBase ?? 0) + (row.yRaw ?? 0)) }
                            : { x: row.x, y: row.y },
                    ),
                    keys: sorted.map((row) => row.key),
                },
            },
            fill: { color: { ...color, a: theme.areaFillOpacity } },
            stroke: { color, width: LINE_STROKE_WIDTH },
        });
    }
    return nodes;
}

function buildPoints(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
): SemanticNode[] {
    // Bubble: an optional `size` channel maps area-proportionally (sqrt) into
    // [BUBBLE_MIN_R, BUBBLE_MAX_R]; without it every glyph keeps POINT_RADIUS.
    const sizeEnc = plan.spec.encoding.find((e) => e.channel === "size");
    const sizeCol = sizeEnc ? column(plan.resolvedData, sizeEnc.field) : undefined;
    const sizeScale = sizeEnc ? plan.scales.get("size") : undefined;
    let radiusOf: ((row: PositionedMark) => number) | null = null;
    if (sizeCol && sizeScale && sizeScale.kind === "linear") {
        const [d0, d1] = sizeScale.domain;
        const s0 = Math.sqrt(Math.max(0, d0));
        const s1 = Math.sqrt(Math.max(0, d1));
        radiusOf = (row) => {
            const v = sizeCol.values[row.rowIndex];
            if (typeof v !== "number" || !Number.isFinite(v)) return BUBBLE_MIN_R;
            if (s1 === s0) return (BUBBLE_MIN_R + BUBBLE_MAX_R) / 2;
            const t = (Math.sqrt(Math.max(0, v)) - s0) / (s1 - s0);
            return BUBBLE_MIN_R + Math.min(1, Math.max(0, t)) * (BUBBLE_MAX_R - BUBBLE_MIN_R);
        };
    }
    return rows.map((row) => {
        const r = radiusOf ? radiusOf(row) : POINT_RADIUS;
        return {
            kind: "ellipse" as const,
            id: `${plan.spec.mark}:${row.key}`,
            role: "chart.mark" as const,
            source: { domain: "chart", path: ["mark", row.key] },
            cx: row.x,
            cy: row.y,
            rx: r,
            ry: r,
            fill: { color: seriesColor(theme, seriesCategories, row.series) },
            ...(theme.pointStroke
                ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } }
                : {}),
        };
    });
}

// ─── Pie / donut ─────────────────────────────────────────────────────────

/** Slices start at twelve o'clock and run clockwise. */
const PIE_START_ANGLE = -Math.PI / 2;

/** Build pie / donut slices from the plan. Angles come from raw theta values
 *  (never scale-applied channels), each slice carries an annular-sector hit
 *  region, and a slice large enough gets a contrast-aware percentage label. */
function buildPie(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
): SemanticNode[] {
    const thetaEnc = plan.spec.encoding.find((e) => e.channel === "theta");
    if (!thetaEnc) return [];
    const thetaCol = column(plan.resolvedData, thetaEnc.field);
    if (!thetaCol) return [];

    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    const rOuter = Math.max(0, Math.min(plot.w, plot.h) / 2);
    const ratio = plan.spec.innerRadiusRatio ?? 0;
    const rInner = rOuter * Math.min(Math.max(ratio, 0), 0.95);
    if (rOuter <= 0) return [];

    const total = plan.marks.reduce((sum, m) => {
        const v = thetaCol.values[m.rowIndex];
        return sum + (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
    if (!(total > 0)) return [];

    const nodes: SemanticNode[] = [];
    let acc = PIE_START_ANGLE;
    for (const mark of plan.marks) {
        const raw = thetaCol.values[mark.rowIndex];
        const value = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
        const share = value / total;
        const a0 = acc;
        const a1 = acc + share * Math.PI * 2;
        acc = a1;
        if (share <= 0) continue;

        const color = seriesColor(theme, seriesCategories, mark.series);
        nodes.push({
            kind: "path",
            id: `pie:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            path: { commands: sliceCommands(cx, cy, rOuter, rInner, a0, a1) },
            fill: { color },
            hitRegion: { sector: { cx, cy, rOuter, rInner, a0, a1 } },
        });

        // Percentage label at the mid-angle when the slice is wide enough —
        // contrast picks dark text on light slices and white on saturated ones.
        const mid = (a0 + a1) / 2;
        const labelR = rInner + (rOuter - rInner) * 0.62;
        const lx = cx + labelR * Math.cos(mid);
        const ly = cy + labelR * Math.sin(mid);
        const pct = `${Math.round(share * 1000) / 10}%`;
        if (arcLengthFits((a1 - a0) * labelR, pct, theme.labelFont.sizePx)) {
            nodes.push({
                kind: "text",
                id: `pie:label:${mark.key}`,
                role: "text",
                source: { domain: "chart", path: ["mark", mark.key, "label"] },
                text: pct,
                font: theme.labelFont,
                anchor: { x: lx, y: ly },
                color: contrastText(color),
            });
        }
    }
    return nodes;
}

/** Arc-length budget: the label must fit inside the slice sweep. */
function arcLengthFits(arcLength: number, label: string, sizePx: number): boolean {
    return estimateTextSize(label, sizePx).width + 6 <= arcLength;
}

/** Pick a readable label color for a slice fill (WCAG-ish luminance split). */
function contrastText(fill: RGBA): RGBA {
    const lum = 0.2126 * fill.r + 0.7152 * fill.g + 0.0722 * fill.b;
    return lum > 0.62 ? { r: 0.07, g: 0.09, b: 0.15, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
}

/** One slice as SVG path commands — a ring sector for donuts, a wedge from
 *  the center for pies. Full-circle slices split into two arcs because SVG
 *  arcs cannot turn 360° in one command. */
function sliceCommands(
    cx: number,
    cy: number,
    rOuter: number,
    rInner: number,
    a0: number,
    a1: number,
): PathCommand[] {
    const sweep = a1 - a0;
    const outer = (a: number) => ({ x: cx + rOuter * Math.cos(a), y: cy + rOuter * Math.sin(a) });
    const inner = (a: number) => ({ x: cx + rInner * Math.cos(a), y: cy + rInner * Math.sin(a) });
    const largeArc = sweep > Math.PI;
    const full = sweep >= Math.PI * 2 - 1e-9;

    if (rInner <= 0) {
        if (full) {
            // Two half-circle arcs around the center.
            const mid = a0 + sweep / 2;
            return [
                { kind: "move", to: outer(a0) },
                { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc: false, sweep: true, to: outer(mid) },
                { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc: false, sweep: true, to: outer(a0) },
                { kind: "close" },
            ];
        }
        return [
            { kind: "move", to: { x: cx, y: cy } },
            { kind: "line", to: outer(a0) },
            { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc, sweep: true, to: outer(a1) },
            { kind: "close" },
        ];
    }
    if (full) {
        const mid = a0 + sweep / 2;
        return [
            { kind: "move", to: outer(a0) },
            { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc: false, sweep: true, to: outer(mid) },
            { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc: false, sweep: true, to: outer(a0) },
            { kind: "line", to: inner(a0) },
            { kind: "arc", rx: rInner, ry: rInner, xRot: 0, largeArc: false, sweep: false, to: inner(mid) },
            { kind: "arc", rx: rInner, ry: rInner, xRot: 0, largeArc: false, sweep: false, to: inner(a0) },
            { kind: "close" },
        ];
    }
    return [
        { kind: "move", to: outer(a0) },
        { kind: "arc", rx: rOuter, ry: rOuter, xRot: 0, largeArc, sweep: true, to: outer(a1) },
        { kind: "line", to: inner(a1) },
        { kind: "arc", rx: rInner, ry: rInner, xRot: 0, largeArc, sweep: false, to: inner(a0) },
        { kind: "close" },
    ];
}

// ─── Radar (polar web) ───────────────────────────────────────────────────

/** Dimension labels truncate into this budget so long names never collide. */
const RADAR_LABEL_BUDGET = 96;
/** Vertex glyph radius — smaller than scatter points, vertices sit on lines. */
const RADAR_VERTEX_RADIUS = 3;

/** Build a radar web: tick rings + spokes as the quiet grid, dimension and
 *  value labels as axis furniture, and one closed polygon per series with a
 *  vertex mark per row (vertex ids carry the row key, so tooltips read real
 *  cell values through the shared mark path). */
function buildRadar(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string = "",
): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    if (!xEnc || !yEnc) return [];
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    if (!xCol || !yCol) return [];

    // Dimension order: the band domain when x is categorical, otherwise the
    // first-appearance order of usable values (radar never positions by a
    // quantitative x — spokes are nominal slots either way).
    const xScale = plan.scales.get(xEnc.channel);
    let dims: string[];
    if (xScale && xScale.kind === "band") {
        dims = xScale.domain.map((d) => String(d));
    } else {
        const seen = new Set<string>();
        for (const v of xCol.values) {
            if (v === null || v === undefined) continue;
            if (typeof v === "number" && !Number.isFinite(v)) continue;
            const key = String(v);
            if (!seen.has(key)) {
                seen.add(key);
            }
        }
        dims = [...seen];
    }
    const n = dims.length;
    if (n === 0) return [];

    const yScale = plan.scales.get(yEnc.channel);
    if (!yScale || yScale.kind !== "linear") return [];
    const [lo, hi] = yScale.domain;
    const span = hi - lo;

    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    const angleOf = (i: number): number => PIE_START_ANGLE + (i / n) * Math.PI * 2;

    // Dimension labels sit outside the web. The outer radius reserves each
    // label's radial half-extent (width near the side spokes, height near top
    // and bottom) so labels stay inside the plot without clipping.
    const dimLabels = dims.map((d) => truncateToWidth(d, RADAR_LABEL_BUDGET, theme.labelFont.sizePx));
    let reserve = 0;
    for (let i = 0; i < n; i++) {
        const a = angleOf(i);
        const size = estimateTextSize(dimLabels[i], theme.labelFont.sizePx);
        const radialHalf = (Math.abs(Math.cos(a)) * size.width) / 2 + (Math.abs(Math.sin(a)) * size.height) / 2;
        reserve = Math.max(reserve, LABEL_GAP + radialHalf);
    }
    const rOuter = Math.max(0, Math.min(plot.w, plot.h) / 2 - reserve);
    if (rOuter <= 0) return [];

    /** Radius in pixels for a data value — the web maps the domain linearly,
     *  so ring ticks keep their data meaning. A degenerate domain (all values
     *  equal) places every vertex on the outer ring. */
    const radiusOf = (v: number): number => (span > 0 ? ((v - lo) / span) * rOuter : rOuter);
    const vertex = (i: number, r: number): { x: number; y: number } => {
        const a = angleOf(i);
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };

    const nodes: SemanticNode[] = [];
    const ticks = niceLinearTicks([lo, hi]);

    // Tick rings — regular n-gons at each tick radius, quietest layer. The
    // minimum tick collapses to the center point and is skipped.
    if (theme.gridStroke) {
        for (const t of ticks.values) {
            const r = radiusOf(t);
            if (r <= 0) continue;
            const ring: PathCommand[] = [{ kind: "move", to: vertex(0, r) }];
            for (let i = 1; i < n; i++) ring.push({ kind: "line", to: vertex(i, r) });
            ring.push({ kind: "close" });
            nodes.push({
                kind: "path",
                id: `${idPrefix}radar:ring:${formatTickLabel(t, ticks.decimals)}`,
                role: "chart.grid",
                path: { commands: ring },
                stroke: { color: theme.gridStroke, width: theme.gridStrokeWidth },
            });
        }
        // Spokes from the center to each dimension's outer vertex.
        for (let i = 0; i < n; i++) {
            nodes.push({
                kind: "path",
                id: `${idPrefix}radar:spoke:${dims[i]}`,
                role: "chart.grid",
                path: { commands: [{ kind: "move", to: { x: cx, y: cy } }, { kind: "line", to: vertex(i, rOuter) }] },
                stroke: { color: theme.gridStroke, width: theme.gridStrokeWidth },
            });
        }
    }

    // Axis furniture: ring value labels along the top spoke, dimension labels
    // outside the web.
    const axisChildren: SemanticNode[] = [];
    for (const t of ticks.values) {
        const r = radiusOf(t);
        if (r <= 0) continue;
        axisChildren.push({
            kind: "text",
            id: `${idPrefix}radar:tick:${formatTickLabel(t, ticks.decimals)}`,
            role: "chart.axis",
            text: formatTickLabel(t, ticks.decimals),
            font: theme.labelFont,
            anchor: { x: cx + LABEL_GAP / 2 + estimateTextSize(formatTickLabel(t, ticks.decimals), theme.labelFont.sizePx).width / 2, y: cy - r },
            color: theme.labelColor,
        });
    }
    for (let i = 0; i < n; i++) {
        const a = angleOf(i);
        const size = estimateTextSize(dimLabels[i], theme.labelFont.sizePx);
        const radialHalf = (Math.abs(Math.cos(a)) * size.width) / 2 + (Math.abs(Math.sin(a)) * size.height) / 2;
        const anchorR = rOuter + LABEL_GAP + radialHalf;
        axisChildren.push({
            kind: "text",
            id: `${idPrefix}radar:dim:${dims[i]}`,
            role: "chart.axis",
            text: dimLabels[i],
            font: theme.labelFont,
            anchor: { x: cx + anchorR * Math.cos(a), y: cy + anchorR * Math.sin(a) },
            color: theme.labelColor,
        });
    }
    if (axisChildren.length > 0) {
        nodes.push({ kind: "group", id: `${idPrefix}radar-axis`, role: "chart.axis", children: axisChildren });
    }

    // One closed polygon per series, plus a vertex mark per data row. Rows
    // are matched to their dimension slot by value; a series missing a
    // dimension simply skips that vertex (never fabricates a zero).
    const bySeries = new Map<string | null, PlanMark[]>();
    for (const mark of plan.marks) {
        const bucket = bySeries.get(mark.series);
        if (bucket) bucket.push(mark);
        else bySeries.set(mark.series, [mark]);
    }
    for (const [name, marks] of bySeries) {
        const points: { mark: PlanMark; x: number; y: number; dimIndex: number }[] = [];
        for (const mark of marks) {
            const rawX = xCol.values[mark.rowIndex];
            const rawY = yCol.values[mark.rowIndex];
            if (rawX === null || rawX === undefined) continue;
            if (typeof rawY !== "number" || !Number.isFinite(rawY)) continue;
            const dimIndex = dims.indexOf(String(rawX));
            if (dimIndex < 0) continue;
            const p = vertex(dimIndex, radiusOf(rawY));
            points.push({ mark, x: p.x, y: p.y, dimIndex });
        }
        if (points.length === 0) continue;
        points.sort((a, b) => a.dimIndex - b.dimIndex);
        const color = seriesColor(theme, seriesCategories, name);
        const commands: PathCommand[] = [{ kind: "move", to: { x: points[0].x, y: points[0].y } }];
        for (const p of points.slice(1)) commands.push({ kind: "line", to: { x: p.x, y: p.y } });
        commands.push({ kind: "close" });
        const seriesId = name ?? "series";
        nodes.push({
            kind: "path",
            id: `${idPrefix}radar-series:${seriesId}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", seriesId] },
            path: { commands },
            fill: { color: { ...color, a: theme.areaFillOpacity } },
            stroke: { color, width: LINE_STROKE_WIDTH },
        });
        for (const p of points) {
            nodes.push({
                kind: "ellipse",
                id: `radar:${p.mark.key}`,
                role: "chart.mark",
                source: { domain: "chart", path: ["mark", p.mark.key] },
                cx: p.x,
                cy: p.y,
                rx: RADAR_VERTEX_RADIUS,
                ry: RADAR_VERTEX_RADIUS,
                fill: { color },
                ...(theme.pointStroke ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } } : {}),
            });
        }
    }
    return nodes;
}

// ─── Facets (small multiples) ────────────────────────────────────────────

/** Inter-panel gaps in a facet grid. */
const FACET_GAP_X = 20;
const FACET_GAP_Y = 16;

/** Lay the plot out as a small-multiple grid: one panel per facet value in
 *  first-appearance order, `ceil(sqrt(n))` columns, shared scales, and a
 *  per-panel title. Rows with a missing facet cell never reach a panel —
 *  compile already warned about them. */
function buildFacets(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
): SemanticNode[] {
    const facetField = plan.spec.facetField;
    if (!facetField) return [];
    const facetCol = column(plan.resolvedData, facetField);
    if (!facetCol) return [];

    // Facet values in first-appearance order over usable cells.
    const values: string[] = [];
    const seen = new Set<string>();
    const facetOfRow = new Map<number, string>();
    for (const mark of plan.marks) {
        const raw = facetCol.values[mark.rowIndex];
        if (raw === null || raw === undefined) continue;
        if (typeof raw === "number" && !Number.isFinite(raw)) continue;
        const value = String(raw);
        facetOfRow.set(mark.rowIndex, value);
        if (!seen.has(value)) {
            seen.add(value);
            values.push(value);
        }
    }
    const n = values.length;
    if (n === 0) return [];

    const cols = Math.ceil(Math.sqrt(n));
    const rowCount = Math.ceil(n / cols);
    const titleH = theme.labelFont.sizePx + 8;
    const cellW = (plot.w - FACET_GAP_X * (cols - 1)) / cols;
    const cellH = (plot.h - FACET_GAP_Y * (rowCount - 1)) / rowCount;

    const nodes: SemanticNode[] = [];
    for (let i = 0; i < n; i++) {
        const value = values[i];
        const colIndex = i % cols;
        const rowIndex = Math.floor(i / cols);
        const cellX = plot.x + colIndex * (cellW + FACET_GAP_X);
        const cellY = plot.y + rowIndex * (cellH + FACET_GAP_Y);
        if (cellW <= 0 || cellH - titleH <= 0) continue;
        const idPrefix = `f${i}:`;

        nodes.push({
            kind: "text",
            id: `${idPrefix}facet:title`,
            role: "chart.axis",
            text: truncateToWidth(value, Math.max(0, cellW - 8), theme.labelFont.sizePx),
            font: theme.labelFont,
            anchor: { x: cellX + cellW / 2, y: cellY + titleH / 2 },
            color: theme.labelColor,
        });

        // The sub-plan filters marks to this facet; scales and the series
        // domain stay shared, so panels are directly comparable.
        const subPlan: ChartCompilePlan = {
            ...plan,
            marks: plan.marks.filter((m) => facetOfRow.get(m.rowIndex) === value),
        };

        if (plan.spec.mark === "pie" || plan.spec.mark === "radar") {
            const panelPlot = { x: cellX, y: cellY + titleH, w: cellW, h: cellH - titleH };
            if (plan.spec.mark === "pie") {
                nodes.push(...buildPie(subPlan, panelPlot, seriesCategories, theme));
            } else {
                nodes.push(...buildRadar(subPlan, panelPlot, seriesCategories, theme, idPrefix));
            }
        } else if (markOwnFrame(plan.spec.mark) && plan.spec.mark !== "heatmap" && plan.spec.mark !== "boxplot" && plan.spec.mark !== "bullet") {
            // Axis-free own frames (gauge / rose / radial-bar / treemap /
            // sankey / funnel / ridgeline) fill the whole cell.
            const panelPlot = { x: cellX, y: cellY + titleH, w: cellW, h: cellH - titleH };
            nodes.push(...buildMarkPanel(subPlan, panelPlot, seriesCategories, theme, idPrefix));
        } else {
            // Axis-bearing panels re-estimate tick-label padding per cell,
            // from the shared scales, so labels stay inside their own panel.
            const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
            const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
            const pad = adaptivePadding({ width: cellW, height: cellH - titleH }, plan, xEnc, yEnc, theme);
            const panelPlot: PlotRect = {
                x: cellX + pad.left,
                y: cellY + titleH + pad.top,
                w: Math.max(0, cellW - pad.left - pad.right),
                h: Math.max(0, cellH - titleH - pad.top - pad.bottom),
            };
            nodes.push(...buildMarkPanel(subPlan, panelPlot, seriesCategories, theme, idPrefix));
        }
    }
    return nodes;
}

// ─── Guides: grid, baselines, ticks, labels, legend ──────────────────────

interface AxisTick {
    readonly label: string;
    readonly position: number;
}

/** Horizontal grid lines at y-axis tick positions — the quietest layer,
 *  emitted before axes and marks so data always sits on top. The baseline
 *  position is skipped: the axis owns that pixel. */
function buildGrid(plot: PlotRect, yScale: Scale, theme: ChartTheme, idPrefix: string = ""): SemanticNode[] {
    if (!theme.gridStroke) return [];
    if (yScale.kind !== "linear" && yScale.kind !== "log") return [];
    const baseline = plot.y + plot.h;
    const nodes: SemanticNode[] = [];
    axisTicks(yScale).forEach((tick, i) => {
        if (Math.abs(tick.position - baseline) < 0.5) return;
        nodes.push({
            kind: "path",
            id: `${idPrefix}y-grid:${i}`,
            role: "chart.grid",
            path: {
                commands: [
                    { kind: "move", to: { x: plot.x, y: tick.position } },
                    { kind: "line", to: { x: plot.x + plot.w, y: tick.position } },
                ],
            },
            stroke: { color: theme.gridStroke!, width: theme.gridStrokeWidth },
        });
    });
    return nodes;
}

/** One axis group: baseline + short tick marks + data-derived tick labels. */
function buildAxis(
    id: string,
    plot: PlotRect,
    scale: Scale,
    orientation: "horizontal" | "vertical",
    theme: ChartTheme,
): SemanticNode {
    const ticks = axisTicks(scale);
    const nodes: SemanticNode[] = [axisBaseline(id, plot, orientation, theme)];

    if (orientation === "horizontal") {
        const baseline = plot.y + plot.h;
        // Categorical slots are the truncation budget: a band / point axis
        // owns `plot.w / domain.length` per label, so long categories never
        // collide with their neighbours. Numeric ticks are bounded by the
        // tick algorithm itself and stay untruncated.
        const slot =
            scale.kind === "band" || scale.kind === "point"
                ? Math.max(0, plot.w / Math.max(1, scale.domain.length) - 2)
                : Number.POSITIVE_INFINITY;
        ticks.forEach((tick, i) => {
            nodes.push(
                shortLine(`${id}:tick:${i}`, tick.position, baseline, tick.position, baseline + TICK_LENGTH, theme),
            );
            const label = truncateToWidth(tick.label, slot, theme.labelFont.sizePx);
            const height = estimateTextSize(label, theme.labelFont.sizePx).height;
            nodes.push(
                labelNode(`${id}:label:${i}`, label, tick.position, baseline + TICK_LENGTH + height / 2, theme),
            );
        });
    } else {
        ticks.forEach((tick, i) => {
            nodes.push(shortLine(`${id}:tick:${i}`, plot.x - TICK_LENGTH, tick.position, plot.x, tick.position, theme));
            const width = estimateTextSize(tick.label, theme.labelFont.sizePx).width;
            const x = Math.max(width / 2 + 1, plot.x - TICK_LENGTH - LABEL_GAP - width / 2);
            nodes.push(labelNode(`${id}:label:${i}`, tick.label, x, tick.position, theme));
        });
    }

    return { kind: "group", id, role: "chart.axis", children: nodes };
}

function axisBaseline(
    id: string,
    plot: PlotRect,
    orientation: "horizontal" | "vertical",
    theme: ChartTheme,
): SemanticNode {
    const baseline = plot.y + plot.h;
    const commands: PathCommand[] =
        orientation === "horizontal"
            ? [
                  { kind: "move", to: { x: plot.x, y: baseline } },
                  { kind: "line", to: { x: plot.x + plot.w, y: baseline } },
              ]
            : [
                  { kind: "move", to: { x: plot.x, y: plot.y } },
                  { kind: "line", to: { x: plot.x, y: baseline } },
              ];
    return {
        kind: "path",
        id: `${id}:baseline`,
        role: "chart.axis",
        path: { commands },
        stroke: axisStroke(theme),
    };
}

function shortLine(
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    theme: ChartTheme,
): SemanticNode {
    return {
        kind: "path",
        id,
        role: "chart.axis",
        path: {
            commands: [
                { kind: "move", to: { x: x1, y: y1 } },
                { kind: "line", to: { x: x2, y: y2 } },
            ],
        },
        stroke: axisStroke(theme),
    };
}

function labelNode(id: string, text: string, x: number, y: number, theme: ChartTheme): SemanticNode {
    return {
        kind: "text",
        id,
        role: "chart.axis",
        text,
        font: theme.labelFont,
        anchor: { x, y },
        color: theme.labelColor,
    };
}

/** Ticks derived from the scale domain — never from a hardcoded list. */
function axisTicks(scale: Scale): AxisTick[] {
    switch (scale.kind) {
        case "band":
        case "point":
            return scale.domain
                .map((category) => ({ label: String(category), position: project(scale, category) }))
                .filter((tick) => Number.isFinite(tick.position));
        case "log": {
            const [lo, hi] = scale.domain;
            const values = lo > 0 && hi > 0 ? [lo, Math.sqrt(lo * hi), hi] : [lo, hi];
            return values
                .map((value) => ({ label: formatTickLabel(value, 2), position: project(scale, value) }))
                .filter((tick) => Number.isFinite(tick.position));
        }
        case "linear": {
            const { values, decimals } = niceLinearTicks(scale.domain);
            return values
                .map((value) => ({ label: formatTickLabel(value, decimals), position: project(scale, value) }))
                .filter((tick) => Number.isFinite(tick.position));
        }
        default:
            return [];
    }
}

/** Extract just the tick label strings from a scale (used by adaptive padding). */
function axisTickLabels(scale: Scale): string[] {
    return axisTicks(scale).map((t) => t.label);
}

// ─── Legend (strip above the plot) ───────────────────────────────────────

interface LegendItem {
    readonly category: string;
    readonly label: string;
    readonly labelWidth: number;
    readonly width: number;
}

/** Row height shared by the strip reservation and the swatch layout. */
function legendRowHeight(theme: ChartTheme): number {
    return Math.max(LEGEND_SWATCH, estimateTextSize("Ag", theme.legendFont.sizePx).height);
}

/** Lay out legend entries left to right, wrapping into up to
 *  `LEGEND_MAX_ROWS` rows against a fixed width. Entries that would overflow
 *  the capped rows are dropped and `buildLegend` adds an explicit `+N`
 *  marker whose width is reserved up front via a bounded fixed-point pass.
 *  An entry opening a row wider than the row squeezes into it (truncated),
 *  so one long label never breaks the strip. */
function layoutLegendRows(
    categories: ReadonlyArray<string>,
    availableWidth: number,
    theme: ChartTheme,
): LegendItem[][] {
    const size = theme.legendFont.sizePx;
    let reserve = 0;
    for (let pass = 0; pass < 4; pass++) {
        const rows = wrapItemsIntoRows(categories, Math.max(0, availableWidth), size, reserve);
        const placed = rows.reduce((a, r) => a + r.length, 0);
        const dropped = categories.length - placed;
        if (dropped === 0) return rows;
        const marker = estimateTextSize(`+${dropped}`, size).width + LEGEND_ITEM_GAP;
        if (marker === reserve) return rows;
        reserve = marker;
    }
    return wrapItemsIntoRows(categories, Math.max(0, availableWidth), size, reserve);
}

/** Greedy wrap into rows; the last row's budget keeps `lastRowReserve` px
 *  for the overflow marker. */
function wrapItemsIntoRows(
    categories: ReadonlyArray<string>,
    width: number,
    size: number,
    lastRowReserve: number,
): LegendItem[][] {
    const rows: LegendItem[][] = [[]];
    let used = 0;
    for (const category of categories) {
        let rowIndex = rows.length - 1;
        let budget = Math.max(0, width - (rowIndex === LEGEND_MAX_ROWS - 1 ? lastRowReserve : 0));
        let item = measureLegendItem(category, size);
        let step = (rows[rowIndex].length === 0 ? 0 : LEGEND_ITEM_GAP) + item.width;
        if (used + step > budget) {
            if (rows[rowIndex].length > 0 && rowIndex + 1 < LEGEND_MAX_ROWS) {
                rows.push([]);
                used = 0;
                rowIndex++;
                budget = Math.max(0, width - (rowIndex === LEGEND_MAX_ROWS - 1 ? lastRowReserve : 0));
                step = item.width;
            } else if (rows[rowIndex].length > 0) {
                // Row cap reached — remaining categories collapse into `+N`.
                break;
            }
            if (item.width > budget) {
                // A row opener wider than the row squeezes into it instead of
                // dropping — the legend never collapses into a bare marker.
                item = squeezeLegendItem(category, budget, size);
                step = item.width;
                if (item.width <= 0) continue;
            }
        }
        rows[rowIndex].push(item);
        used += step;
    }
    return rows.filter((r) => r.length > 0);
}

/** Measure one legend entry, truncating its label into the per-item budget. */
function measureLegendItem(category: string, size: number): LegendItem {
    const label = truncateToWidth(category, LEGEND_LABEL_BUDGET, size);
    const labelWidth = estimateTextSize(label, size).width;
    return { category, label, labelWidth, width: LEGEND_SWATCH + LEGEND_SWATCH_GAP + labelWidth };
}

/** Truncate an entry into an explicit pixel budget (narrow rows). */
function squeezeLegendItem(category: string, budget: number, size: number): LegendItem {
    const labelBudget = Math.max(0, budget - LEGEND_SWATCH - LEGEND_SWATCH_GAP);
    const label = truncateToWidth(category, labelBudget, size);
    const labelWidth = estimateTextSize(label, size).width;
    return { category, label, labelWidth, width: LEGEND_SWATCH + LEGEND_SWATCH_GAP + labelWidth };
}

/** The legend strip: horizontal rows above the plot, swatches aligned with
 *  palette order. It never overlaps data because its height is part of the
 *  top padding; entries wrap across up to `LEGEND_MAX_ROWS` rows and dropped
 *  categories leave an explicit `+N` marker at the end of the last row. */
function buildLegend(
    plan: ChartCompilePlan,
    plot: PlotRect,
    rows: ReadonlyArray<ReadonlyArray<LegendItem>>,
    theme: ChartTheme,
): SemanticNode[] {
    const placed = rows.reduce((a, r) => a + r.length, 0);
    if (placed === 0) return [];
    const categories = plan.series.categories;
    const size = theme.legendFont.sizePx;
    const rowHeight = legendRowHeight(theme);
    const stripTop = plot.y - LEGEND_BOTTOM_GAP - rows.length * rowHeight - (rows.length - 1) * LEGEND_ROW_GAP;

    const children: SemanticNode[] = [];
    let index = 0;
    rows.forEach((row, rowIndex) => {
        const rowTop = stripTop + rowIndex * (rowHeight + LEGEND_ROW_GAP);
        const textMid = rowTop + rowHeight / 2;
        const swatchTop = rowTop + (rowHeight - LEGEND_SWATCH) / 2;
        let cursor = plot.x;
        for (const item of row) {
            // Use the same palette index as `seriesColor` so legend swatches
            // match mark colors one-for-one.
            const color = seriesColor(theme, categories, item.category);
            children.push({
                kind: "rect",
                id: `legend:swatch:${index}`,
                role: "chart.legend",
                x: cursor,
                y: swatchTop,
                w: LEGEND_SWATCH,
                h: LEGEND_SWATCH,
                rx: 2,
                ry: 2,
                fill: { color },
            });
            children.push({
                kind: "text",
                id: `legend:label:${index}`,
                role: "chart.legend",
                text: item.label,
                font: theme.legendFont,
                anchor: { x: cursor + LEGEND_SWATCH + LEGEND_SWATCH_GAP + item.labelWidth / 2, y: textMid },
                color: theme.labelColor,
            });
            cursor += item.width + LEGEND_ITEM_GAP;
            index += 1;
        }
    });

    // Dropped categories get an explicit overflow marker — the legend never
    // silently pretends the chart has fewer series than the data does.
    const dropped = categories.length - placed;
    if (dropped > 0) {
        const marker = `+${dropped}`;
        const lastRow = rows[rows.length - 1];
        const rowTop = stripTop + (rows.length - 1) * (rowHeight + LEGEND_ROW_GAP);
        const lastRowEnd = lastRow.reduce((acc, item) => acc + item.width, 0) + LEGEND_ITEM_GAP * Math.max(0, lastRow.length - 1);
        children.push({
            kind: "text",
            id: "legend:overflow",
            role: "chart.legend",
            text: marker,
            font: theme.legendFont,
            anchor: {
                x: plot.x + lastRowEnd + LEGEND_ITEM_GAP + estimateTextSize(marker, size).width / 2,
                y: rowTop + rowHeight / 2,
            },
            color: theme.labelColor,
        });
    }

    return [{ kind: "group", id: "chart-legend", role: "chart.legend", children }];
}

// ─── Own-frame builders (heatmap / radial / hierarchy / flow / special) ──

function clamp01(t: number): number {
    return Math.min(1, Math.max(0, t));
}

/** Sample the sequential heatmap ramp at t ∈ [0, 1] with stop interpolation. */
function sampleRamp(ramp: ReadonlyArray<RGBA>, t: number): RGBA {
    if (ramp.length === 0) return { r: 0, g: 0, b: 0, a: 1 };
    if (ramp.length === 1) return ramp[0];
    const pos = clamp01(t) * (ramp.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(ramp.length - 1, i0 + 1);
    const f = pos - i0;
    const a = ramp[i0];
    const b = ramp[i1];
    return {
        r: a.r + (b.r - a.r) * f,
        g: a.g + (b.g - a.g) * f,
        b: a.b + (b.b - a.b) * f,
        a: 1,
    };
}

/** Heatmap: band × band cells colored by a quantitative color channel. The
 *  y band runs top-down so the first category reads at the top. A stepped
 *  gradient legend with min / max labels replaces the categorical strip. */
function buildHeatmap(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    const cEnc = plan.spec.encoding.find((e) => e.channel === "color");
    if (!xEnc || !yEnc || !cEnc) return [];
    const xScale = plan.scales.get("x");
    const yScale = plan.scales.get("y");
    const cScale = plan.scales.get("color");
    if (!xScale || xScale.kind !== "band" || !yScale || yScale.kind !== "band" || !cScale || cScale.kind !== "linear") {
        return [];
    }
    const xPix: Scale = { ...xScale, range: [plot.x, plot.x + plot.w] };
    const yPix: Scale = { ...yScale, range: [plot.y, plot.y + plot.h] };
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    const cCol = column(plan.resolvedData, cEnc.field);
    if (!xCol || !yCol || !cCol) return [];
    const [d0, d1] = cScale.domain;
    const colorOf = (v: number): RGBA => sampleRamp(theme.heatmapRamp, d1 > d0 ? (v - d0) / (d1 - d0) : 1);

    const nodes: SemanticNode[] = [];
    const spark = plan.spec.spark === true;
    if (!spark && theme.gridStroke) {
        // Frame the cell grid so empty rows / columns still read as slots.
        nodes.push({
            kind: "rect",
            id: `${idPrefix}heatmap:frame`,
            role: "chart.grid",
            x: plot.x,
            y: plot.y,
            w: plot.w,
            h: plot.h,
            stroke: { color: theme.gridStroke, width: theme.gridStrokeWidth },
        });
    }
    for (const mark of plan.marks) {
        const xRaw = xCol.values[mark.rowIndex];
        const yRaw = yCol.values[mark.rowIndex];
        if (xRaw === null || xRaw === undefined || yRaw === null || yRaw === undefined) continue;
        const xv = apply(xPix, String(xRaw));
        const yv = apply(yPix, String(yRaw));
        const cw = bandwidth(xPix);
        const ch = bandwidth(yPix);
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
        const v = cCol.values[mark.rowIndex];
        const value = typeof v === "number" && Number.isFinite(v) ? v : d0;
        nodes.push({
            kind: "rect",
            id: `heatmap:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            x: xv + 0.5,
            y: yv + 0.5,
            w: Math.max(0.5, cw - 1),
            h: Math.max(0.5, ch - 1),
            fill: { color: colorOf(value) },
            hitRegion: { rect: { x: xv, y: yv, w: cw, h: ch } },
        });
    }
    if (!spark) {
        nodes.push(buildAxis(`${idPrefix}x-axis`, plot, xPix, "horizontal", theme));
        nodes.push(buildAxis(`${idPrefix}y-axis`, plot, yPix, "vertical", theme));
        nodes.push(...buildHeatmapRampLegend(plot, cScale.domain, theme, idPrefix));
    }
    return nodes;
}

/** Stepped gradient strip for the heatmap color domain, with min / max
 *  labels at the ends. Sits in the legend strip above the plot. */
function buildHeatmapRampLegend(
    plot: PlotRect,
    domain: readonly [number, number],
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const STEPS = 24;
    const stripW = Math.min(180, Math.max(60, plot.w / 2));
    const stripH = 10;
    const y = plot.y - LEGEND_BOTTOM_GAP - stripH;
    const nodes: SemanticNode[] = [];
    const stepW = stripW / STEPS;
    for (let i = 0; i < STEPS; i++) {
        nodes.push({
            kind: "rect",
            id: `${idPrefix}heatmap-ramp:${i}`,
            role: "chart.legend",
            x: plot.x + i * stepW,
            y,
            w: stepW + 0.5,
            h: stripH,
            fill: { color: sampleRamp(theme.heatmapRamp, i / (STEPS - 1)) },
        });
    }
    const minLabel = formatTickLabel(domain[0], 2);
    const maxLabel = formatTickLabel(domain[1], 2);
    const minW = estimateTextSize(minLabel, theme.legendFont.sizePx).width;
    nodes.push({
        kind: "text",
        id: `${idPrefix}heatmap-ramp:min`,
        role: "chart.legend",
        text: minLabel,
        font: theme.legendFont,
        anchor: { x: plot.x - LABEL_GAP - minW / 2, y: y + stripH / 2 },
        color: theme.labelColor,
    });
    const maxW = estimateTextSize(maxLabel, theme.legendFont.sizePx).width;
    nodes.push({
        kind: "text",
        id: `${idPrefix}heatmap-ramp:max`,
        role: "chart.legend",
        text: maxLabel,
        font: theme.legendFont,
        anchor: { x: plot.x + stripW + LABEL_GAP + maxW / 2, y: y + stripH / 2 },
        color: theme.labelColor,
    });
    return nodes;
}

// ─── Gauge (240° sweep) ──────────────────────────────────────────────────

const GAUGE_A0 = (5 * Math.PI) / 6; // 150° in screen angles (0 = +x, cw)
const GAUGE_SWEEP = (4 * Math.PI) / 3; // 240°

/** Gauge: one value against a domain on a 240° track, ticks and a center
 *  value label. The hit region is the filled value sweep. */
function buildGauge(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const thetaEnc = plan.spec.encoding.find((e) => e.channel === "theta");
    if (!thetaEnc) return [];
    const thetaCol = column(plan.resolvedData, thetaEnc.field);
    if (!thetaCol) return [];
    const mark = plan.marks[0];
    if (!mark) return [];
    const raw = thetaCol.values[mark.rowIndex];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return [];
    const domain = plan.spec.valueDomain ?? [0, 100];
    const span = domain[1] - domain[0];
    if (!(span > 0)) return [];
    const t = clamp01((raw - domain[0]) / span);

    const r = Math.max(0, Math.min(plot.w / 2, plot.h / 1.5));
    if (r <= 0) return [];
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + r + 2;
    const rIn = r * 0.72;

    const nodes: SemanticNode[] = [];
    nodes.push({
        kind: "path",
        id: `${idPrefix}gauge:track`,
        role: "chart.grid",
        path: { commands: sliceCommands(cx, cy, r, rIn, GAUGE_A0, GAUGE_A0 + GAUGE_SWEEP) },
        fill: { color: theme.trackColor },
    });
    const a1 = GAUGE_A0 + t * GAUGE_SWEEP;
    nodes.push({
        kind: "path",
        id: `gauge:${mark.key}`,
        role: "chart.mark",
        source: { domain: "chart", path: ["mark", mark.key] },
        path: { commands: sliceCommands(cx, cy, r, rIn, GAUGE_A0, a1) },
        fill: { color: theme.markFill },
        hitRegion: { sector: { cx, cy, rOuter: r, rInner: rIn, a0: GAUGE_A0, a1 } },
    });
    // Five domain labels inside the track hole.
    for (let i = 0; i <= 4; i++) {
        const ang = GAUGE_A0 + (GAUGE_SWEEP * i) / 4;
        const label = formatTickLabel(domain[0] + (span * i) / 4, 2);
        nodes.push({
            kind: "text",
            id: `${idPrefix}gauge:tick:${i}`,
            role: "chart.axis",
            text: label,
            font: theme.labelFont,
            anchor: { x: cx + r * 0.55 * Math.cos(ang), y: cy + r * 0.55 * Math.sin(ang) },
            color: theme.labelColor,
        });
    }
    nodes.push({
        kind: "text",
        id: `${idPrefix}gauge:value`,
        role: "text",
        text: formatTickLabel(raw, 2),
        font: { ...theme.labelFont, sizePx: Math.round(theme.labelFont.sizePx * 1.8) },
        anchor: { x: cx, y: cy + r * 0.42 },
        color: theme.labelColor,
    });
    return nodes;
}

// ─── Rose / radial-bar (polar bars) ──────────────────────────────────────

/** Rose: equal-angle petals per category, radius proportional to value. */
function buildRose(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    if (!xEnc || !yEnc) return [];
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    const yScale = plan.scales.get("y");
    if (!xCol || !yCol || !yScale || yScale.kind !== "linear") return [];
    const xScale = plan.scales.get("x");
    const dims = xScale && xScale.kind === "band" ? xScale.domain.map(String) : plan.series.categories;
    const n = dims.length;
    if (n === 0) return [];

    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    // Reserve label space outside the petals, like the radar dimension labels.
    const labels = dims.map((d) => truncateToWidth(d, RADAR_LABEL_BUDGET, theme.labelFont.sizePx));
    const angleOf = (i: number): number => PIE_START_ANGLE + (i / n) * Math.PI * 2;
    let reserve = 0;
    for (let i = 0; i < n; i++) {
        const a = angleOf(i);
        const size = estimateTextSize(labels[i], theme.labelFont.sizePx);
        const radialHalf = (Math.abs(Math.cos(a)) * size.width) / 2 + (Math.abs(Math.sin(a)) * size.height) / 2;
        reserve = Math.max(reserve, LABEL_GAP + radialHalf);
    }
    const r = Math.max(0, Math.min(plot.w, plot.h) / 2 - reserve);
    if (r <= 0) return [];
    const yPix: Scale = { ...yScale, range: [0, r] };
    const [lo, hi] = yScale.domain;

    const nodes: SemanticNode[] = [];
    // Ring grid: real circles at nice value ticks, labels along the top.
    if (theme.gridStroke) {
        const ticks = niceLinearTicks([lo, hi]);
        for (const t of ticks.values) {
            const rr = apply(yPix, t);
            if (!(rr > 0)) continue;
            nodes.push({
                kind: "ellipse",
                id: `${idPrefix}rose:ring:${formatTickLabel(t, ticks.decimals)}`,
                role: "chart.grid",
                cx,
                cy,
                rx: rr,
                ry: rr,
                stroke: { color: theme.gridStroke, width: theme.gridStrokeWidth },
            });
            nodes.push({
                kind: "text",
                id: `${idPrefix}rose:tick:${formatTickLabel(t, ticks.decimals)}`,
                role: "chart.axis",
                text: formatTickLabel(t, ticks.decimals),
                font: theme.labelFont,
                anchor: { x: cx + LABEL_GAP, y: cy - rr },
                color: theme.labelColor,
            });
        }
    }
    const pad = n > 1 ? 0.03 : 0;
    for (const mark of plan.marks) {
        const xRaw = xCol.values[mark.rowIndex];
        const v = yCol.values[mark.rowIndex];
        if (xRaw === null || xRaw === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
        const i = dims.indexOf(String(xRaw));
        if (i < 0) continue;
        const sweep = (Math.PI * 2) / n;
        const a0 = PIE_START_ANGLE + i * sweep + pad / 2;
        const a1 = PIE_START_ANGLE + (i + 1) * sweep - pad / 2;
        const ro = apply(yPix, v);
        const color = seriesColor(theme, seriesCategories, mark.series ?? String(xRaw));
        nodes.push({
            kind: "path",
            id: `rose:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            path: { commands: sliceCommands(cx, cy, Math.max(0.5, ro), 0, a0, a1) },
            fill: { color },
            hitRegion: { sector: { cx, cy, rOuter: Math.max(0.5, ro), rInner: 0, a0, a1 } },
        });
    }
    // Category labels at the petal mid-angles.
    for (let i = 0; i < n; i++) {
        const a = angleOf(i);
        const size = estimateTextSize(labels[i], theme.labelFont.sizePx);
        const radialHalf = (Math.abs(Math.cos(a)) * size.width) / 2 + (Math.abs(Math.sin(a)) * size.height) / 2;
        const anchorR = r + LABEL_GAP + radialHalf;
        nodes.push({
            kind: "text",
            id: `${idPrefix}rose:dim:${dims[i]}`,
            role: "chart.axis",
            text: labels[i],
            font: theme.labelFont,
            anchor: { x: cx + anchorR * Math.cos(a), y: cy + anchorR * Math.sin(a) },
            color: theme.labelColor,
        });
    }
    return nodes;
}

/** Radial bar: concentric rings, sweep angle proportional to value / max. */
function buildRadialBar(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    if (!xEnc || !yEnc) return [];
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    const yScale = plan.scales.get("y");
    if (!xCol || !yCol || !yScale || yScale.kind !== "linear") return [];
    const xScale = plan.scales.get("x");
    const cats = xScale && xScale.kind === "band" ? xScale.domain.map(String) : plan.series.categories;
    const n = cats.length;
    if (n === 0) return [];
    const [, hi] = yScale.domain;
    if (!(hi > 0)) return [];

    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    const rOuter0 = Math.max(0, Math.min(plot.w, plot.h) / 2);
    const ringW = rOuter0 / (n + 0.5);
    const gap = ringW * 0.2;
    if (ringW - gap <= 0) return [];

    const nodes: SemanticNode[] = [];
    for (const mark of plan.marks) {
        const xRaw = xCol.values[mark.rowIndex];
        const v = yCol.values[mark.rowIndex];
        if (xRaw === null || xRaw === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
        const i = cats.indexOf(String(xRaw));
        if (i < 0) continue;
        const ro = rOuter0 - i * ringW;
        const ri = ro - ringW + gap;
        const color = seriesColor(theme, seriesCategories, mark.series ?? String(xRaw));
        nodes.push({
            kind: "path",
            id: `${idPrefix}radial-track:${i}`,
            role: "chart.grid",
            path: { commands: sliceCommands(cx, cy, ro, ri, 0, Math.PI * 2) },
            fill: { color: theme.trackColor },
        });
        const sweep = (v / hi) * Math.PI * 2;
        const a1 = PIE_START_ANGLE + sweep;
        nodes.push({
            kind: "path",
            id: `radial-bar:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            path: { commands: sliceCommands(cx, cy, ro, ri, PIE_START_ANGLE, a1) },
            fill: { color },
            hitRegion: { sector: { cx, cy, rOuter: ro, rInner: ri, a0: PIE_START_ANGLE, a1 } },
        });
        // Value label at the sweep end when the arc has room for it.
        const labelR = (ro + ri) / 2;
        const label = formatTickLabel(v, 2);
        if (sweep * labelR > estimateTextSize(label, theme.labelFont.sizePx).width + 6) {
            nodes.push({
                kind: "text",
                id: `${idPrefix}radial-bar:label:${mark.key}`,
                role: "text",
                text: label,
                font: theme.labelFont,
                anchor: { x: cx + labelR * Math.cos(a1), y: cy + labelR * Math.sin(a1) },
                color: theme.labelColor,
            });
        }
    }
    return nodes;
}

// ─── Treemap (squarified) ────────────────────────────────────────────────

interface TreemapRect {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** Worst aspect ratio of a candidate squarify row (areas in px² along `side`). */
function worstAspect(areas: ReadonlyArray<number>, side: number): number {
    const sum = areas.reduce((a, b) => a + b, 0);
    if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
    const thickness = sum / side;
    let worst = 0;
    for (const a of areas) {
        const len = a / thickness;
        if (!(len > 0)) return Number.POSITIVE_INFINITY;
        const ratio = Math.max(thickness / len, len / thickness);
        if (ratio > worst) worst = ratio;
    }
    return worst;
}

/** Squarified layout (Bruls–Huizing–van Wijk): items sorted by descending
 *  value, rows grown while the worst aspect ratio keeps improving. */
function squarify(items: ReadonlyArray<{ key: string; value: number }>, rect: PlotRect): TreemapRect[] {
    const out: TreemapRect[] = [];
    const total = items.reduce((a, b) => a + b.value, 0);
    if (items.length === 0) return out;
    if (total <= 0 || rect.w <= 0 || rect.h <= 0) {
        for (const it of items) out.push({ key: it.key, x: rect.x, y: rect.y, w: 0, h: 0 });
        return out;
    }
    const scale = (rect.w * rect.h) / total;
    let cx = rect.x;
    let cy = rect.y;
    let cw = rect.w;
    let ch = rect.h;
    let idx = 0;
    while (idx < items.length) {
        const side = Math.min(cw, ch);
        const row = [items[idx++]];
        let rowSum = row[0].value;
        while (idx < items.length) {
            const worstNow = worstAspect(row.map((it) => it.value * scale), side);
            const worstCand = worstAspect([...row.map((it) => it.value * scale), items[idx].value * scale], side);
            if (worstCand <= worstNow) {
                row.push(items[idx++]);
                rowSum += row[row.length - 1].value;
            } else {
                break;
            }
        }
        const thickness = (rowSum * scale) / side;
        let offset = 0;
        for (const it of row) {
            const len = (it.value * scale) / thickness;
            if (cw >= ch) {
                out.push({ key: it.key, x: cx, y: cy + offset, w: thickness, h: len });
            } else {
                out.push({ key: it.key, x: cx + offset, y: cy, w: len, h: thickness });
            }
            offset += len;
        }
        if (cw >= ch) {
            cx += thickness;
            cw -= thickness;
        } else {
            cy += thickness;
            ch -= thickness;
        }
    }
    return out;
}

/** Treemap: hierarchy from keyField / parentField, areas from compile-time
 *  subtree sums, squarified layout, colored by top-level group. */
function buildTreemap(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const keyField = plan.spec.keyField;
    const parentField = plan.spec.parentField;
    const sizeEnc = plan.spec.encoding.find((e) => e.channel === "size");
    if (!keyField || !parentField || !sizeEnc) return [];
    const keyCol = column(plan.resolvedData, keyField);
    const parentCol = column(plan.resolvedData, parentField);
    if (!keyCol || !parentCol) return [];

    interface TNode {
        key: string;
        parent: string | null;
        value: number;
        children: string[];
    }
    const nodesByKey = new Map<string, TNode>();
    const markByKey = new Map<string, (typeof plan.marks)[number]>();
    for (const mark of plan.marks) {
        const pv = parentCol.values[mark.rowIndex];
        const parent = pv === null || pv === undefined || (typeof pv === "number" && !Number.isFinite(pv)) ? null : String(pv);
        const value = Number(mark.channels.get("subtree") ?? 0);
        nodesByKey.set(mark.key, { key: mark.key, parent, value, children: [] });
        markByKey.set(mark.key, mark);
    }
    // Parent references that do not resolve to a node hang at the root
    // (compile already warned about the orphans).
    const roots: string[] = [];
    for (const node of nodesByKey.values()) {
        if (node.parent !== null && nodesByKey.has(node.parent) && node.parent !== node.key) {
            nodesByKey.get(node.parent)!.children.push(node.key);
        } else {
            roots.push(node.key);
        }
    }
    // Top-level group per node (palette identity) and depth (fill alpha).
    // With a single synthetic root, its children are the color groups —
    // otherwise every rect collapses into one palette slot.
    const depthOf = new Map<string, number>();
    const topOf = new Map<string, string>();
    const colorRoots = roots.length === 1 ? (nodesByKey.get(roots[0])?.children ?? roots) : roots;
    const assign = (key: string, top: string, depth: number): void => {
        topOf.set(key, top);
        depthOf.set(key, depth);
        for (const c of nodesByKey.get(key)?.children ?? []) assign(c, top, depth + 1);
    };
    for (const r of roots) assign(r, r, 1);
    // Re-assign color identity: each color root is its own group.
    if (roots.length === 1) {
        const assignTop = (key: string, top: string): void => {
            topOf.set(key, top);
            for (const c of nodesByKey.get(key)?.children ?? []) assignTop(c, top);
        };
        for (const g of colorRoots) assignTop(g, g);
    }
    const topOrder = colorRoots;

    const nodes: SemanticNode[] = [];
    const PAD = 2;
    const lay = (parentKey: string | null, rect: PlotRect): void => {
        const childKeys = parentKey === null ? roots : (nodesByKey.get(parentKey)?.children ?? []);
        const items = childKeys
            .map((key) => ({ key, value: nodesByKey.get(key)!.value }))
            .filter((it) => it.value > 0)
            .sort((a, b) => b.value - a.value);
        if (items.length === 0) return;
        for (const r of squarify(items, rect)) {
            const node = nodesByKey.get(r.key)!;
            const mark = markByKey.get(r.key)!;
            const top = topOf.get(r.key) ?? r.key;
            const depth = depthOf.get(r.key) ?? 1;
            const base = seriesColor(theme, topOrder, top);
            const alpha = depth === 1 ? 1 : Math.max(0.5, 1 - 0.12 * (depth - 1));
            const x = r.x + PAD / 2;
            const y = r.y + PAD / 2;
            const w = Math.max(0, r.w - PAD);
            const h = Math.max(0, r.h - PAD);
            nodes.push({
                kind: "rect",
                id: `treemap:${r.key}`,
                role: "chart.mark",
                source: { domain: "chart", path: ["mark", r.key] },
                x,
                y,
                w,
                h,
                fill: { color: { ...base, a: alpha } },
                ...(theme.pointStroke ? { stroke: { color: theme.pointStroke, width: 1 } } : {}),
            });
            // Labels belong to leaves — a parent's label would collide with
            // the labels of the children filling it.
            const label = node.children.length === 0 ? truncateToWidth(r.key, Math.max(0, w - 8), theme.labelFont.sizePx) : "";
            const lw = estimateTextSize(label, theme.labelFont.sizePx).width;
            const lh = estimateTextSize(label, theme.labelFont.sizePx).height;
            if (label !== "" && lw + 8 <= w && lh + 4 <= h) {
                nodes.push({
                    kind: "text",
                    id: `${idPrefix}treemap:label:${r.key}`,
                    role: "text",
                    text: label,
                    font: theme.labelFont,
                    anchor: { x: x + w / 2, y: y + lh / 2 + 1 },
                    color: contrastText({ ...base, a: 1 }),
                });
            }
            // Recurse into the padded content rect.
            if (node.children.length > 0 && w > 4 && h > 4) {
                lay(r.key, { x: x + 2, y: y + 2, w: w - 4, h: h - 4 });
            }
        }
    };
    lay(null, plot);
    void markByKey;
    return nodes;
}

// ─── Sankey (layered flows) ──────────────────────────────────────────────

const SANKEY_NODE_W = 14;
const SANKEY_NODE_PAD = 10;
const SANKEY_CURVE = 0.5;

/** Point on a cubic bezier at t. */
function cubicAt(
    p0: { x: number; y: number },
    c1: { x: number; y: number },
    c2: { x: number; y: number },
    p1: { x: number; y: number },
    t: number,
): { x: number; y: number } {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
        x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
        y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
    };
}

/** Sankey: layered nodes with value-proportional heights and bezier link
 *  ribbons. Depth = longest path from sources; a few barycenter sweeps order
 *  nodes inside columns to reduce crossings. Links carry polygon hit
 *  regions sampled from their ribbon outline. */
function buildSankey(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const sEnc = plan.spec.encoding.find((e) => e.channel === "source");
    const tEnc = plan.spec.encoding.find((e) => e.channel === "target");
    const vEnc = plan.spec.encoding.find((e) => e.channel === "value");
    if (!sEnc || !tEnc || !vEnc) return [];
    const sCol = column(plan.resolvedData, sEnc.field);
    const tCol = column(plan.resolvedData, tEnc.field);
    const vCol = column(plan.resolvedData, vEnc.field);
    if (!sCol || !tCol || !vCol) return [];

    interface SLink {
        key: string;
        s: string;
        t: string;
        v: number;
        sy: number;
        ty: number;
    }
    interface SNode {
        name: string;
        depth: number;
        value: number;
        y0: number;
        y1: number;
    }
    const links: SLink[] = [];
    for (const m of plan.marks) {
        const s = sCol.values[m.rowIndex];
        const t = tCol.values[m.rowIndex];
        const v = vCol.values[m.rowIndex];
        if (s === null || s === undefined || t === null || t === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
        links.push({ key: m.key, s: String(s), t: String(t), v, sy: 0, ty: 0 });
    }
    if (links.length === 0) return [];

    const nodeOrder: string[] = [];
    const nodesByName = new Map<string, SNode>();
    const touch = (name: string): SNode => {
        const hit = nodesByName.get(name);
        if (hit) return hit;
        const node: SNode = { name, depth: 0, value: 0, y0: 0, y1: 0 };
        nodesByName.set(name, node);
        nodeOrder.push(name);
        return node;
    };
    const outLinks = new Map<string, SLink[]>();
    const inLinks = new Map<string, SLink[]>();
    for (const l of links) {
        touch(l.s);
        touch(l.t);
        const ol = outLinks.get(l.s);
        if (ol) ol.push(l);
        else outLinks.set(l.s, [l]);
        const il = inLinks.get(l.t);
        if (il) il.push(l);
        else inLinks.set(l.t, [l]);
    }
    for (const name of nodeOrder) {
        const n = nodesByName.get(name)!;
        const sumIn = (inLinks.get(name) ?? []).reduce((a, l) => a + l.v, 0);
        const sumOut = (outLinks.get(name) ?? []).reduce((a, l) => a + l.v, 0);
        n.value = Math.max(sumIn, sumOut);
    }

    // Depth = longest path from sources (the graph is a DAG per compile).
    const edges = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    for (const l of links) {
        const set = edges.get(l.s);
        if (set) set.add(l.t);
        else edges.set(l.s, new Set([l.t]));
    }
    for (const name of nodeOrder) if (!indegree.has(name)) indegree.set(name, 0);
    for (const l of links) indegree.set(l.t, (indegree.get(l.t) ?? 0) + 1);
    const queue = nodeOrder.filter((n) => (indegree.get(n) ?? 0) === 0);
    while (queue.length > 0) {
        const n = queue.shift()!;
        const d = nodesByName.get(n)!.depth;
        for (const next of edges.get(n) ?? []) {
            const node = nodesByName.get(next)!;
            node.depth = Math.max(node.depth, d + 1);
            const left = (indegree.get(next) ?? 1) - 1;
            indegree.set(next, left);
            if (left === 0) queue.push(next);
        }
    }
    const maxDepth = Math.max(0, ...nodeOrder.map((n) => nodesByName.get(n)!.depth));

    const columns: string[][] = [];
    for (const name of nodeOrder) {
        const d = nodesByName.get(name)!.depth;
        (columns[d] ??= []).push(name);
    }
    const columnX = (d: number): number =>
        maxDepth === 0 ? plot.x + (plot.w - SANKEY_NODE_W) / 2 : plot.x + (d * (plot.w - SANKEY_NODE_W)) / maxDepth;

    // Vertical scale: the tightest column fits the plot height exactly.
    let ky = Number.POSITIVE_INFINITY;
    for (const col of columns) {
        const sum = col.reduce((a, n) => a + nodesByName.get(n)!.value, 0);
        if (sum <= 0) continue;
        const budget = plot.h - (col.length - 1) * SANKEY_NODE_PAD;
        if (budget > 0) ky = Math.min(ky, budget / sum);
    }
    if (!Number.isFinite(ky) || ky <= 0) ky = 1;

    const stack = (): void => {
        for (const col of columns) {
            let y = plot.y;
            for (const name of col) {
                const n = nodesByName.get(name)!;
                n.y0 = y;
                n.y1 = y + Math.max(1, n.value * ky);
                y = n.y1 + SANKEY_NODE_PAD;
            }
        }
    };
    stack();

    // Barycenter sweeps reduce crossings: order each column by the average
    // neighbour position, forward then backward, re-stacking each time.
    const mid = (name: string): number => {
        const n = nodesByName.get(name)!;
        return (n.y0 + n.y1) / 2;
    };
    for (let pass = 0; pass < 4; pass++) {
        for (let d = 1; d < columns.length; d++) {
            columns[d].sort((a, b) => {
                const avgA = (inLinks.get(a) ?? []).reduce((s, l) => s + mid(l.s) * l.v, 0) / Math.max(1e-9, (inLinks.get(a) ?? []).reduce((s, l) => s + l.v, 0));
                const avgB = (inLinks.get(b) ?? []).reduce((s, l) => s + mid(l.s) * l.v, 0) / Math.max(1e-9, (inLinks.get(b) ?? []).reduce((s, l) => s + l.v, 0));
                return avgA - avgB;
            });
        }
        for (let d = columns.length - 2; d >= 0; d--) {
            columns[d].sort((a, b) => {
                const avgA = (outLinks.get(a) ?? []).reduce((s, l) => s + mid(l.t) * l.v, 0) / Math.max(1e-9, (outLinks.get(a) ?? []).reduce((s, l) => s + l.v, 0));
                const avgB = (outLinks.get(b) ?? []).reduce((s, l) => s + mid(l.t) * l.v, 0) / Math.max(1e-9, (outLinks.get(b) ?? []).reduce((s, l) => s + l.v, 0));
                return avgA - avgB;
            });
        }
        stack();
    }

    // Link offsets inside each node: outgoing stack top-down in target order,
    // incoming likewise, so ribbons never share an edge pixel.
    for (const name of nodeOrder) {
        let offset = nodesByName.get(name)!.y0;
        for (const l of outLinks.get(name) ?? []) {
            l.sy = offset;
            offset += l.v * ky;
        }
        offset = nodesByName.get(name)!.y0;
        for (const l of inLinks.get(name) ?? []) {
            l.ty = offset;
            offset += l.v * ky;
        }
    }

    const nodes: SemanticNode[] = [];
    const colorOf = (name: string): RGBA => seriesColor(theme, nodeOrder, name);
    for (const l of links) {
        const sn = nodesByName.get(l.s)!;
        const tn = nodesByName.get(l.t)!;
        const x0 = columnX(sn.depth) + SANKEY_NODE_W;
        const x1 = columnX(tn.depth);
        const h = Math.max(1, l.v * ky);
        const y0t = l.sy;
        const y1t = l.ty;
        const y0b = y0t + h;
        const y1b = y1t + h;
        const dx = (x1 - x0) * SANKEY_CURVE;
        const topC1 = { x: x0 + dx, y: y0t };
        const topC2 = { x: x1 - dx, y: y1t };
        const botC1 = { x: x1 - dx, y: y1b };
        const botC2 = { x: x0 + dx, y: y0b };
        const commands: PathCommand[] = [
            { kind: "move", to: { x: x0, y: y0t } },
            { kind: "cubic", cp1: topC1, cp2: topC2, to: { x: x1, y: y1t } },
            { kind: "line", to: { x: x1, y: y1b } },
            { kind: "cubic", cp1: botC1, cp2: botC2, to: { x: x0, y: y0b } },
            { kind: "close" },
        ];
        const outline: { x: number; y: number }[] = [];
        for (let i = 0; i <= 8; i++) outline.push(cubicAt({ x: x0, y: y0t }, topC1, topC2, { x: x1, y: y1t }, i / 8));
        for (let i = 0; i <= 8; i++) outline.push(cubicAt({ x: x1, y: y1b }, botC1, botC2, { x: x0, y: y0b }, i / 8));
        const sourceColor = colorOf(l.s);
        nodes.push({
            kind: "path",
            id: `sankey:${l.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", l.key] },
            path: { commands },
            fill: { color: { ...sourceColor, a: theme.sankeyLinkOpacity } },
            hitRegion: { polygon: { points: outline } },
        });
    }
    for (const name of nodeOrder) {
        const n = nodesByName.get(name)!;
        const x = columnX(n.depth);
        nodes.push({
            kind: "rect",
            id: `sankey-node:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["node", name] },
            x,
            y: n.y0,
            w: SANKEY_NODE_W,
            h: Math.max(1, n.y1 - n.y0),
            fill: { color: colorOf(name) },
        });
        const label = truncateToWidth(name, 96, theme.labelFont.sizePx);
        const w = estimateTextSize(label, theme.labelFont.sizePx).width;
        const rightSide = n.depth < maxDepth;
        nodes.push({
            kind: "text",
            id: `${idPrefix}sankey:label:${name}`,
            role: "chart.axis",
            text: label,
            font: theme.labelFont,
            anchor: rightSide
                ? { x: x + SANKEY_NODE_W + LABEL_GAP + w / 2, y: (n.y0 + n.y1) / 2 }
                : { x: x - LABEL_GAP - w / 2, y: (n.y0 + n.y1) / 2 },
            color: theme.labelColor,
        });
    }
    return nodes;
}

// ─── Funnel ──────────────────────────────────────────────────────────────

/** Funnel: centered trapezoids per stage, widths proportional to value,
 *  sorted descending. Labels carry the stage name and share of the first. */
function buildFunnel(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    if (!xEnc || !yEnc) return [];
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    if (!xCol || !yCol) return [];
    const stages = plan.marks
        .map((m) => {
            const v = yCol.values[m.rowIndex];
            const label = xCol.values[m.rowIndex];
            return { key: m.key, series: m.series, label: label === null || label === undefined ? m.key : String(label), v: typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN };
        })
        .filter((s): s is { key: string; series: string | null; label: string; v: number } => Number.isFinite(s.v))
        .sort((a, b) => b.v - a.v);
    if (stages.length === 0) return [];
    const max = stages[0].v;
    if (!(max > 0)) return [];

    const nodes: SemanticNode[] = [];
    const stageH = plot.h / stages.length;
    const cx = plot.x + plot.w / 2;
    stages.forEach((s, i) => {
        const wTop = (s.v / max) * plot.w;
        const next = stages[i + 1];
        const wBot = next ? (next.v / max) * plot.w : wTop;
        const y0 = plot.y + i * stageH;
        const y1 = y0 + Math.max(0, stageH - 2);
        const color = seriesColor(theme, seriesCategories, s.series ?? s.label);
        const points = [
            { x: cx - wTop / 2, y: y0 },
            { x: cx + wTop / 2, y: y0 },
            { x: cx + wBot / 2, y: y1 },
            { x: cx - wBot / 2, y: y1 },
        ];
        nodes.push({
            kind: "path",
            id: `funnel:${s.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", s.key] },
            path: {
                commands: [
                    { kind: "move", to: points[0] },
                    { kind: "line", to: points[1] },
                    { kind: "line", to: points[2] },
                    { kind: "line", to: points[3] },
                    { kind: "close" },
                ],
            },
            fill: { color },
            hitRegion: { polygon: { points } },
        });
        const pct = `${Math.round((s.v / max) * 1000) / 10}%`;
        const label = truncateToWidth(`${s.label} ${pct}`, Math.max(0, Math.min(wTop, wBot) - 8), theme.labelFont.sizePx);
        if (label !== "" && stageH > estimateTextSize(label, theme.labelFont.sizePx).height + 4) {
            nodes.push({
                kind: "text",
                id: `${idPrefix}funnel:label:${s.key}`,
                role: "text",
                text: label,
                font: theme.labelFont,
                anchor: { x: cx, y: (y0 + y1) / 2 },
                color: contrastText(color),
            });
        }
    });
    return nodes;
}

// ─── Ridgeline ───────────────────────────────────────────────────────────

/** Ridgeline: one density ribbon per group, overlapping vertically, read
 *  from the compile-time KDE grid. The x axis stays shared and honest. */
function buildRidgeline(
    plan: ChartCompilePlan,
    plot: PlotRect,
    seriesCategories: ReadonlyArray<string> | undefined,
    theme: ChartTheme,
    idPrefix: string,
): SemanticNode[] {
    const stat = plan.stat;
    if (!stat) return [];
    const gCol = column(stat, "group");
    const gxCol = column(stat, "gx");
    const gyCol = column(stat, "gy");
    if (!gCol || !gxCol || !gyCol) return [];
    const xScale = pixelScale(plan.scales.get("x"), [plot.x, plot.x + plot.w]);
    if (!xScale) return [];
    const groups = seriesCategories ?? plan.series.categories;
    const n = groups.length;
    if (n === 0) return [];
    // Baselines are `step` apart, each ridge is `ridgeH = step / (1 - overlap)`
    // tall, and the last baseline lands exactly on the plot bottom:
    // plot.h = ridgeH + (n − 1) · step.
    const OVERLAP = 0.6;
    const ridgeH = n > 1 ? plot.h / (1 + (n - 1) * (1 - OVERLAP)) : plot.h;
    const step = n > 1 ? ridgeH * (1 - OVERLAP) : 0;

    const nodes: SemanticNode[] = [];
    nodes.push(buildAxis(`${idPrefix}x-axis`, plot, xScale, "horizontal", theme));
    groups.forEach((g, gi) => {
        const mark = plan.marks.find((m) => m.series === g);
        if (!mark) return;
        const pts: { gx: number; gy: number }[] = [];
        for (let i = mark.rowIndex; i < stat.rowCount; i++) {
            if (String(gCol.values[i]) !== g) break;
            pts.push({ gx: Number(gxCol.values[i]), gy: Number(gyCol.values[i]) });
        }
        if (pts.length === 0) return;
        const baseline = plot.y + ridgeH + step * gi;
        const scaleY = ridgeH * 0.95;
        const top = pts.map((p) => ({ x: project(xScale, p.gx), y: baseline - p.gy * scaleY }));
        const outline = [{ x: top[0].x, y: baseline }, ...top, { x: top[top.length - 1].x, y: baseline }];
        const color = seriesColor(theme, seriesCategories, g);
        nodes.push({
            kind: "path",
            id: `ridgeline:${g}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", g] },
            path: {
                commands: [
                    { kind: "move", to: outline[0] },
                    ...outline.slice(1).map((p) => ({ kind: "line" as const, to: p })),
                    { kind: "close" },
                ],
            },
            hitRegion: { polygon: { points: outline } },
            fill: { color: { ...color, a: 0.85 } },
            stroke: { color, width: 1.5 },
        });
        const label = truncateToWidth(g, Math.max(0, plot.x - 8), theme.labelFont.sizePx);
        if (label !== "") {
            const w = estimateTextSize(label, theme.labelFont.sizePx).width;
            nodes.push({
                kind: "text",
                id: `${idPrefix}ridgeline:label:${g}`,
                role: "chart.axis",
                text: label,
                font: theme.labelFont,
                anchor: { x: plot.x - LABEL_GAP - w / 2, y: baseline - ridgeH * 0.4 },
                color: theme.labelColor,
            });
        }
    });
    return nodes;
}

// ─── Bullet ──────────────────────────────────────────────────────────────

/** Bullet: horizontal measure bars over qualitative range bands with a
 *  target tick. One row per category, shared quantitative axis below. */
function buildBullet(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    const tEnc = plan.spec.encoding.find((e) => e.channel === "target");
    const rEnc = plan.spec.encoding.find((e) => e.channel === "range");
    if (!xEnc || !yEnc || !tEnc) return [];
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    const tCol = column(plan.resolvedData, tEnc.field);
    const rCol = rEnc ? column(plan.resolvedData, rEnc.field) : undefined;
    const vScale = pixelScale(plan.scales.get("y"), [plot.x, plot.x + plot.w]);
    if (!xCol || !yCol || !tCol || !vScale || vScale.kind !== "linear") return [];
    const n = plan.marks.length;
    if (n === 0) return [];
    const slotH = plot.h / n;
    const barH = Math.min(slotH * 0.45, 26);
    const x0 = project(vScale, 0);

    const nodes: SemanticNode[] = [];
    nodes.push(buildAxis(`${idPrefix}x-axis`, plot, vScale, "horizontal", theme));
    plan.marks.forEach((mark, i) => {
        const measure = yCol.values[mark.rowIndex];
        const target = tCol.values[mark.rowIndex];
        if (typeof measure !== "number" || !Number.isFinite(measure)) return;
        if (typeof target !== "number" || !Number.isFinite(target)) return;
        const rangeRaw = rCol ? rCol.values[mark.rowIndex] : null;
        const rangeMax = typeof rangeRaw === "number" && Number.isFinite(rangeRaw) && rangeRaw > 0 ? rangeRaw : Math.max(measure, target);
        const slotY = plot.y + i * slotH;
        const cy = slotY + slotH / 2;
        const bandH = slotH * 0.76;
        [1, 0.85, 0.6].forEach((f, fi) => {
            const bx = project(vScale, rangeMax * f);
            nodes.push({
                kind: "rect",
                id: `${idPrefix}bullet:range:${mark.key}:${fi}`,
                role: "chart.grid",
                x: x0,
                y: cy - bandH / 2,
                w: Math.max(0, bx - x0),
                h: bandH,
                fill: { color: theme.rangeTints[fi] },
            });
        });
        const mx = project(vScale, measure);
        nodes.push({
            kind: "rect",
            id: `bullet:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            x: x0,
            y: cy - barH / 2,
            w: Math.max(0, mx - x0),
            h: barH,
            fill: { color: theme.markFill },
        });
        const tx = project(vScale, target);
        nodes.push({
            kind: "path",
            id: `${idPrefix}bullet:target:${mark.key}`,
            role: "decorative",
            path: {
                commands: [
                    { kind: "move", to: { x: tx, y: cy - barH * 0.75 } },
                    { kind: "line", to: { x: tx, y: cy + barH * 0.75 } },
                ],
            },
            stroke: { color: theme.axisStroke, width: 2 },
        });
        const catRaw = xCol.values[mark.rowIndex];
        const cat = catRaw === null || catRaw === undefined ? mark.key : String(catRaw);
        const budget = Math.max(0, plot.x - 8);
        const label = truncateToWidth(cat, budget, theme.labelFont.sizePx);
        if (label !== "" && budget > 20) {
            const w = estimateTextSize(label, theme.labelFont.sizePx).width;
            nodes.push({
                kind: "text",
                id: `${idPrefix}bullet:label:${mark.key}`,
                role: "chart.axis",
                text: label,
                font: theme.labelFont,
                anchor: { x: plot.x - LABEL_GAP - w / 2, y: cy },
                color: theme.labelColor,
            });
        }
    });
    return nodes;
}

// ─── Boxplot ─────────────────────────────────────────────────────────────

/** Boxplot: five-number box + whiskers per category, outliers as points.
 *  All statistics come from the compile-time stat snapshot. */
function buildBoxplot(plan: ChartCompilePlan, plot: PlotRect, theme: ChartTheme, idPrefix: string): SemanticNode[] {
    const stat = plan.stat;
    if (!stat) return [];
    const catCol = column(stat, "category");
    const kindCol = column(stat, "kind");
    const lowCol = column(stat, "low");
    const q1Col = column(stat, "q1");
    const medCol = column(stat, "median");
    const q3Col = column(stat, "q3");
    const highCol = column(stat, "high");
    const valueCol = column(stat, "value");
    if (!catCol || !kindCol || !lowCol || !q1Col || !medCol || !q3Col || !highCol || !valueCol) return [];
    const xScale = pixelScale(plan.scales.get("x"), [plot.x, plot.x + plot.w]);
    const yScale = pixelScale(plan.scales.get("y"), [plot.y + plot.h, plot.y]);
    if (!xScale || xScale.kind !== "band" || !yScale) return [];
    const bw = bandwidth(xScale) * 0.5;

    const nodes: SemanticNode[] = [];
    const spark = plan.spec.spark === true;
    if (!spark) {
        nodes.push(...buildGrid(plot, yScale, theme, idPrefix));
        nodes.push(buildAxis(`${idPrefix}x-axis`, plot, xScale, "horizontal", theme));
        nodes.push(buildAxis(`${idPrefix}y-axis`, plot, yScale, "vertical", theme));
    }
    for (const mark of plan.marks) {
        const i = mark.rowIndex;
        const kind = String(kindCol.values[i]);
        const cat = String(catCol.values[i]);
        const cx = project(xScale, cat);
        if (!Number.isFinite(cx)) continue;
        if (kind === "outlier") {
            const v = Number(valueCol.values[i]);
            const y = project(yScale, v);
            if (!Number.isFinite(y)) continue;
            nodes.push({
                kind: "ellipse",
                id: `boxplot:${mark.key}`,
                role: "chart.mark",
                source: { domain: "chart", path: ["mark", mark.key] },
                cx,
                cy: y,
                rx: 2.5,
                ry: 2.5,
                fill: { color: theme.markFill },
                ...(theme.pointStroke ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } } : {}),
            });
            continue;
        }
        const yLow = project(yScale, Number(lowCol.values[i]));
        const yQ1 = project(yScale, Number(q1Col.values[i]));
        const yMed = project(yScale, Number(medCol.values[i]));
        const yQ3 = project(yScale, Number(q3Col.values[i]));
        const yHigh = project(yScale, Number(highCol.values[i]));
        if (![yLow, yQ1, yMed, yQ3, yHigh].every(Number.isFinite)) continue;
        const x0 = cx - bw / 2;
        const x1 = cx + bw / 2;
        nodes.push({
            kind: "path",
            id: `boxplot:${mark.key}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["mark", mark.key] },
            path: {
                commands: [
                    { kind: "move", to: { x: x0, y: yQ3 } },
                    { kind: "line", to: { x: x1, y: yQ3 } },
                    { kind: "line", to: { x: x1, y: yQ1 } },
                    { kind: "line", to: { x: x0, y: yQ1 } },
                    { kind: "close" },
                    { kind: "move", to: { x: cx, y: yQ3 } },
                    { kind: "line", to: { x: cx, y: yHigh } },
                    { kind: "move", to: { x: cx, y: yLow } },
                    { kind: "line", to: { x: cx, y: yQ1 } },
                    { kind: "move", to: { x: cx - bw * 0.25, y: yHigh } },
                    { kind: "line", to: { x: cx + bw * 0.25, y: yHigh } },
                    { kind: "move", to: { x: cx - bw * 0.25, y: yLow } },
                    { kind: "line", to: { x: cx + bw * 0.25, y: yLow } },
                    { kind: "move", to: { x: x0, y: yMed } },
                    { kind: "line", to: { x: x1, y: yMed } },
                ],
            },
            fill: { color: { ...theme.markFill, a: 0.25 } },
            stroke: { color: theme.markFill, width: 1.5 },
            hitRegion: { rect: { x: x0, y: Math.min(yHigh, yLow), w: bw, h: Math.abs(yLow - yHigh) } },
        });
    }
    return nodes;
}

// ─── Scale → pixel mapping ───────────────────────────────────────────────

function pixelScale(scale: Scale | undefined, range: [number, number]): Scale | undefined {
    if (!scale) return undefined;
    const mid = (range[0] + range[1]) / 2;
    switch (scale.kind) {
        case "linear":
            if (scale.domain[0] === scale.domain[1]) {
                return { kind: "linear", domain: [0, 1], range: [mid, mid] };
            }
            return { ...scale, range };
        case "log":
            if (scale.domain[0] <= 0 || scale.domain[1] <= 0) return undefined;
            return { ...scale, range };
        case "band":
        case "point":
            return { ...scale, range };
        default:
            // Quantile ranges are threshold lists, not a continuous viewport.
            return undefined;
    }
}

function project(scale: Scale, raw: number | string | boolean | null): number {
    if (raw === null || raw === undefined) return Number.NaN;
    if (scale.kind === "band") {
        const start = apply(scale, String(raw));
        if (!Number.isFinite(start)) return Number.NaN;
        return start + bandwidth(scale) / 2;
    }
    if (scale.kind === "point") {
        return apply(scale, String(raw));
    }
    const numeric = typeof raw === "number" ? raw : typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
    if (!Number.isFinite(numeric)) return Number.NaN;
    return apply(scale, numeric);
}

// ─── Viewport ────────────────────────────────────────────────────────────

function plotRect(viewport: ChartViewport, padding: ScenePadding): PlotRect {
    const width = dimension(viewport.width);
    const height = dimension(viewport.height);
    return {
        x: padding.left,
        y: padding.top,
        w: Math.max(0, width - padding.left - padding.right),
        h: Math.max(0, height - padding.top - padding.bottom),
    };
}

function dimension(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

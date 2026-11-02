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

    // The legend reserves its own strip above the plot, so it can never
    // cover data. Base padding (from axis labels) fixes the plot width, the
    // legend is laid out against that width once, and its strip height feeds
    // the top padding before the final plot rect is computed.
    const basePadding = adaptivePadding(viewport, plan, xEnc, yEnc, theme);
    const legendWidth = Math.max(0, dimension(viewport.width) - basePadding.left - basePadding.right);
    const legendItems =
        plan.series.field !== null ? layoutLegendItems(plan.series.categories, legendWidth, theme) : [];
    const legendHeight = legendItems.length > 0 ? legendRowHeight(theme) + LEGEND_BOTTOM_GAP : 0;
    const padding: ScenePadding = { ...basePadding, top: basePadding.top + legendHeight };
    const plot = plotRect(viewport, padding);

    // Pie marks live outside the cartesian frame: no axes, no grid, slices
    // fill the plot. Everything else (legend, theme, identity) is shared.
    if (plan.spec.mark === "pie") {
        const children: SemanticNode[] = [];
        if (plot.w > 0 && plot.h > 0) {
            children.push(...buildPie(plan, plot, seriesCategories, theme));
            children.push(...buildLegend(plan, plot, legendItems, theme));
        }
        return {
            version: SCENE_VERSION,
            root: {
                kind: "group",
                id: "chart-root",
                role: "group",
                children,
            },
        };
    }

    // Radar marks replace the cartesian frame with a polar web: spoke lines,
    // tick rings and dimension labels around the plot. Series polygons and
    // vertices stay ordinary marks with stable ids.
    if (plan.spec.mark === "radar") {
        const children: SemanticNode[] = [];
        if (plot.w > 0 && plot.h > 0) {
            children.push(...buildRadar(plan, plot, seriesCategories, theme));
            children.push(...buildLegend(plan, plot, legendItems, theme));
        }
        return {
            version: SCENE_VERSION,
            root: {
                kind: "group",
                id: "chart-root",
                role: "group",
                children,
            },
        };
    }

    // Facets split the plot into a small-multiple grid: one panel per facet
    // value with shared scales, and the legend stays global.
    if (plan.spec.facetField) {
        const children: SemanticNode[] = [
            ...buildFacets(plan, plot, seriesCategories, theme),
            ...buildLegend(plan, plot, legendItems, theme),
        ];
        return {
            version: SCENE_VERSION,
            root: {
                kind: "group",
                id: "chart-root",
                role: "group",
                children,
            },
        };
    }

    const children: SemanticNode[] = [];

    if (xEnc && yEnc && plot.w > 0 && plot.h > 0) {
        children.push(...buildCartesianPanel(plan, plot, seriesCategories, theme, ""));
        children.push(...buildLegend(plan, plot, legendItems, theme));
    }

    return {
        version: SCENE_VERSION,
        root: {
            kind: "group",
            id: "chart-root",
            role: "group",
            children,
        },
    };
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
    if (!xEnc || !yEnc || plot.w <= 0 || plot.h <= 0) return [];
    const xScale = pixelScale(plan.scales.get(xEnc.channel), [plot.x, plot.x + plot.w]);
    const yScale = pixelScale(plan.scales.get(yEnc.channel), [plot.y + plot.h, plot.y]);
    const xCol = column(plan.resolvedData, xEnc.field);
    const yCol = column(plan.resolvedData, yEnc.field);
    if (!xScale || !yScale || !xCol || !yCol) return [];
    const rows = positionedRows(plan, xScale, yScale, xCol, yCol);
    return [
        ...buildGrid(plot, yScale, theme, idPrefix),
        buildAxis(`${idPrefix}x-axis`, plot, xScale, "horizontal", theme),
        buildAxis(`${idPrefix}y-axis`, plot, yScale, "vertical", theme),
        ...buildMarks(plan, rows, plot, xScale, yScale, seriesCategories, theme, idPrefix),
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
    yCol: DataColumn,
): ReadonlyArray<PositionedMark> {
    const rows: PositionedMark[] = [];
    for (const mark of plan.marks) {
        const x = project(xScale, xCol.values[mark.rowIndex] ?? null);
        const y = project(yScale, yCol.values[mark.rowIndex] ?? null);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const rawY = yCol.values[mark.rowIndex] ?? null;
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
        case "line":
            return buildLines(rows, seriesCategories, theme, idPrefix);
        case "area":
            return buildAreas(rows, plot, yScale, seriesCategories, theme, layout, idPrefix);
        case "point":
        case "circle":
            return buildPoints(plan, rows, seriesCategories, theme);
        default:
            // `compile` rejects unimplemented marks with
            // `davinci.chart.unsupported-mark`, so reaching this branch means
            // the plan was hand-built outside the contract. Silence would
            // render an empty chart with no explanation; refuse loudly.
            throw new Error(`davinci.chart.unsupported-mark: scene builder has no geometry for mark "${String(plan.spec.mark)}"`);
    }
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
        let x = row.x;
        let yTop = row.y;
        let yBottom = zeroBaseline(yScale, plot);

        if (layout === "stack" && row.stackBase !== null && row.yRaw !== null) {
            // Stacked: span from the cumulative base to base + value. The y
            // scale domain already covers the stacked extent (compile).
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
            rx: layout === "stack" ? 0 : radius(h),
            ry: layout === "stack" ? 0 : radius(h),
            fill: { color: seriesColor(theme, seriesCategories, row.series) },
        };
    });
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
    return rows.map((row) => ({
        kind: "ellipse" as const,
        id: `${plan.spec.mark}:${row.key}`,
        role: "chart.mark" as const,
        source: { domain: "chart", path: ["mark", row.key] },
        cx: row.x,
        cy: row.y,
        rx: POINT_RADIUS,
        ry: POINT_RADIUS,
        fill: { color: seriesColor(theme, seriesCategories, row.series) },
        ...(theme.pointStroke
            ? { stroke: { color: theme.pointStroke, width: POINT_STROKE_WIDTH } }
            : {}),
    }));
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
        } else {
            // Cartesian panels re-estimate tick-label padding per cell, from
            // the shared scales, so labels stay inside their own panel.
            const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
            const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
            const pad = adaptivePadding({ width: cellW, height: cellH - titleH }, plan, xEnc, yEnc, theme);
            const panelPlot: PlotRect = {
                x: cellX + pad.left,
                y: cellY + titleH + pad.top,
                w: Math.max(0, cellW - pad.left - pad.right),
                h: Math.max(0, cellH - titleH - pad.top - pad.bottom),
            };
            nodes.push(...buildCartesianPanel(subPlan, panelPlot, seriesCategories, theme, idPrefix));
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

/** Lay out legend entries left to right on one row against a fixed width.
 *  The first category is always kept (truncated into the row if needed) so
 *  a legend never collapses into a bare overflow marker; entries that would
 *  overflow are dropped and `buildLegend` adds an explicit `+N` marker. The
 *  marker's own width is reserved up front via a bounded fixed-point pass,
 *  so the strip never overflows and never pretends the chart has fewer
 *  series than the data does. */
function layoutLegendItems(
    categories: ReadonlyArray<string>,
    availableWidth: number,
    theme: ChartTheme,
): LegendItem[] {
    const size = theme.legendFont.sizePx;
    let reserve = 0;
    for (let pass = 0; pass < 4; pass++) {
        const items = layoutItemsInto(categories, Math.max(0, availableWidth - reserve), size);
        const dropped = categories.length - items.length;
        if (dropped === 0) return items;
        const marker = estimateTextSize(`+${dropped}`, size).width + LEGEND_ITEM_GAP;
        if (marker === reserve) return items;
        reserve = marker;
    }
    return layoutItemsInto(categories, Math.max(0, availableWidth - reserve), size);
}

/** Greedy single-row layout into `width`; the first category squeezes into
 *  the row instead of dropping when nothing fits. */
function layoutItemsInto(categories: ReadonlyArray<string>, width: number, size: number): LegendItem[] {
    let used = 0;
    const items: LegendItem[] = [];
    for (const category of categories) {
        const label = truncateToWidth(category, LEGEND_LABEL_BUDGET, size);
        const labelWidth = estimateTextSize(label, size).width;
        const itemWidth = LEGEND_SWATCH + LEGEND_SWATCH_GAP + labelWidth;
        if (items.length === 0 && itemWidth > width) {
            const budget = Math.max(0, width - LEGEND_SWATCH - LEGEND_SWATCH_GAP);
            const squeezed = truncateToWidth(category, budget, size);
            const squeezedWidth = estimateTextSize(squeezed, size).width;
            items.push({
                category,
                label: squeezed,
                labelWidth: squeezedWidth,
                width: LEGEND_SWATCH + LEGEND_SWATCH_GAP + squeezedWidth,
            });
            continue;
        }
        const step = items.length === 0 ? itemWidth : LEGEND_ITEM_GAP + itemWidth;
        if (used + step > width) break;
        items.push({ category, label, labelWidth, width: itemWidth });
        used += step;
    }
    return items;
}

/** The legend strip: one horizontal row above the plot, swatches aligned
 *  with palette order. It never overlaps data because its height is part of
 *  the top padding. */
function buildLegend(
    plan: ChartCompilePlan,
    plot: PlotRect,
    items: ReadonlyArray<LegendItem>,
    theme: ChartTheme,
): SemanticNode[] {
    if (items.length === 0) return [];
    const categories = plan.series.categories;
    const size = theme.legendFont.sizePx;
    const rowHeight = legendRowHeight(theme);
    const stripTop = plot.y - LEGEND_BOTTOM_GAP - rowHeight;
    const textMid = stripTop + rowHeight / 2;
    const swatchTop = stripTop + (rowHeight - LEGEND_SWATCH) / 2;

    const children: SemanticNode[] = [];
    let cursor = plot.x;
    items.forEach((item, i) => {
        // Use the same palette index as `seriesColor` so legend swatches match
        // mark colors one-for-one.
        const color = seriesColor(theme, categories, item.category);
        children.push({
            kind: "rect",
            id: `legend:swatch:${i}`,
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
            id: `legend:label:${i}`,
            role: "chart.legend",
            text: item.label,
            font: theme.legendFont,
            anchor: { x: cursor + LEGEND_SWATCH + LEGEND_SWATCH_GAP + item.labelWidth / 2, y: textMid },
            color: theme.labelColor,
        });
        cursor += item.width + LEGEND_ITEM_GAP;
    });

    // Dropped categories get an explicit overflow marker — the legend never
    // silently pretends the chart has fewer series than the data does.
    const dropped = categories.length - items.length;
    if (dropped > 0) {
        const marker = `+${dropped}`;
        children.push({
            kind: "text",
            id: "legend:overflow",
            role: "chart.legend",
            text: marker,
            font: theme.legendFont,
            anchor: { x: cursor + estimateTextSize(marker, size).width / 2, y: textMid },
            color: theme.labelColor,
        });
    }

    return [{ kind: "group", id: "chart-legend", role: "chart.legend", children }];
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

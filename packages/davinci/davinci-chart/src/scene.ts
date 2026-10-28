// Chart scene builder — ChartCompilePlan + viewport → SemanticScene.
//
// The compile plan carries scales with a host-independent range (linear stays
// in [0, 1], band uses one step per category). This module is the only place
// that turns those ranges into pixels, so `compile` never guesses a viewport.
// It emits mark geometry plus axis baselines, tick labels and a minimal legend
// — no theme, motion or interaction state.
//
// Node identity comes from `rowIndex` (bar / point) or the series value (line),
// never from the position of an item in a temporary array.

import { rgb8, type FontSpec, type PathCommand, type RGBA } from "@doki-land/davinci-types";
import { estimateTextSize, type SemanticNode, type SemanticScene } from "@doki-land/davinci-scene";
import type { ChartCompilePlan } from "./compile.js";
import { column, type DataColumn } from "./data.js";
import { apply, bandwidth, type Scale } from "./scale.js";

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
    readonly x: number;
    readonly y: number;
    readonly series: string | null;
}

const DEFAULT_PADDING = 16;
// Base fill for ungrouped marks (no color/series encoding). Grouped marks use
// LEGEND_PALETTE via `seriesColor` so each series is visually distinct.
const MARK_FILL: RGBA = rgb8(51, 51, 51);
const LINE_STROKE_WIDTH = 2;
const POINT_RADIUS = 5;
const BAR_RATIO = 0.72;

// Guides (baselines, ticks, labels, legend) share one muted palette so the
// marks stay visually dominant.
const AXIS_STROKE = { color: rgb8(160, 160, 160), width: 1 };
const LABEL_COLOR: RGBA = rgb8(85, 85, 85);
const LABEL_FONT: FontSpec = { family: "sans-serif", sizePx: 11 };
const LEGEND_FONT: FontSpec = { family: "sans-serif", sizePx: 11 };
const TICK_LENGTH = 4;
const LABEL_GAP = 6;
const LEGEND_SWATCH = 10;
const LEGEND_SWATCH_GAP = 6;
const LEGEND_EDGE_GAP = 6;
const LEGEND_ITEM_STEP = 18;
const MAX_TICK_DECIMALS = 6;
const MAX_TICKS = 12;
const LEGEND_PALETTE: ReadonlyArray<RGBA> = [
    rgb8(31, 119, 180),
    rgb8(255, 127, 14),
    rgb8(44, 160, 44),
    rgb8(214, 39, 40),
    rgb8(148, 103, 189),
    rgb8(140, 86, 75),
];

/** Given a series label, return its LEGEND_PALETTE index (stable across callers). */
function seriesPaletteIndex(categories: ReadonlyArray<string>, series: string): number {
    const idx = categories.indexOf(series);
    return idx < 0 ? 0 : idx;
}

/** Given a series label, return its palette color. Falls back to MARK_FILL when ungrouped. */
function seriesColor(categories: ReadonlyArray<string> | undefined, series: string | null): RGBA {
    if (!categories || categories.length === 0 || series === null) return MARK_FILL;
    return LEGEND_PALETTE[seriesPaletteIndex(categories, series) % LEGEND_PALETTE.length];
}

/** Collect unique non-null category values from a data column, preserving first-seen order. */
function collectCategories(col: { values: ReadonlyArray<unknown> } | undefined): string[] {
    if (!col) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of col.values) {
        if (v === null || v === undefined) continue;
        if (typeof v === "number" && !Number.isFinite(v)) continue;
        const key = String(v);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

/** Build a SemanticScene from a ChartCompilePlan and a pixel viewport. */
export function buildScene(plan: ChartCompilePlan, viewport: ChartViewport): SemanticScene {
    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    const seriesEnc = plan.spec.encoding.find(
        (e) => e.channel === "series" || e.channel === "color" || e.channel === "group",
    );
    const seriesCategories = seriesEnc ? collectCategories(column(plan.resolvedData, seriesEnc.field)) : undefined;

    // Compute adaptive plot padding so axis labels and tick marks do not get
    // clipped. Defaults are only a floor — Y-axis label width and X-axis
    // label height expand left and bottom padding as needed.
    const padding = adaptivePadding(viewport, plan, xEnc, yEnc);
    const plot = plotRect(viewport, padding);
    const children: SemanticNode[] = [];

    if (xEnc && yEnc && plot.w > 0 && plot.h > 0) {
        const xScale = pixelScale(plan.scales.get(xEnc.channel), [plot.x, plot.x + plot.w]);
        const yScale = pixelScale(plan.scales.get(yEnc.channel), [plot.y + plot.h, plot.y]);
        const xCol = column(plan.resolvedData, xEnc.field);
        const yCol = column(plan.resolvedData, yEnc.field);
        const seriesCol = seriesEnc ? column(plan.resolvedData, seriesEnc.field) : undefined;

        if (xScale && yScale && xCol && yCol) {
            const rows = positionedRows(plan, xScale, yScale, xCol, yCol, seriesCol);
            children.push(buildAxis("x-axis", plot, xScale, "horizontal"));
            children.push(buildAxis("y-axis", plot, yScale, "vertical"));
            children.push(...buildMarks(plan, rows, plot, xScale, yScale, seriesCategories));
            children.push(...buildLegend(plan, plot));
        }
    }

    return {
        root: {
            kind: "group",
            id: "chart-root",
            role: "group",
            children,
        },
    };
}

/** Compute per-side padding that fits tick labels for both axes. */
function adaptivePadding(
    viewport: ChartViewport,
    plan: ChartCompilePlan,
    xEnc: { field: string; channel: string } | undefined,
    yEnc: { field: string; channel: string } | undefined,
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
            (acc, label) => Math.max(acc, estimateTextSize(label, LABEL_FONT.sizePx).width),
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
            (acc, label) => Math.max(acc, estimateTextSize(label, LABEL_FONT.sizePx).height),
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
    seriesCol: DataColumn | undefined,
): ReadonlyArray<PositionedMark> {
    const rows: PositionedMark[] = [];
    for (const mark of plan.marks) {
        const x = project(xScale, xCol.values[mark.rowIndex] ?? null);
        const y = project(yScale, yCol.values[mark.rowIndex] ?? null);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const rawSeries = seriesCol ? (seriesCol.values[mark.rowIndex] ?? null) : null;
        rows.push({ rowIndex: mark.rowIndex, x, y, series: rawSeries === null ? null : String(rawSeries) });
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
): SemanticNode[] {
    switch (plan.spec.mark) {
        case "bar":
        case "rect":
            return buildBars(plan, rows, plot, xScale, yScale, seriesCategories);
        case "line":
            return buildLines(rows, seriesCategories);
        case "point":
        case "circle":
            return buildPoints(plan, rows, seriesCategories);
        default:
            return [];
    }
}

function buildBars(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
    yScale: Scale,
    seriesCategories: ReadonlyArray<string> | undefined,
): SemanticNode[] {
    const bandWidth = xScale.kind === "band" ? bandwidth(xScale) : 0;
    const step = bandWidth > 0 ? bandWidth : plot.w / Math.max(1, rows.length);
    const w = step * BAR_RATIO;
    const baseline = zeroBaseline(yScale, plot);

    return rows.map((row) => ({
        kind: "rect" as const,
        id: `${plan.spec.mark}:${row.rowIndex}`,
        role: "chart.mark" as const,
        source: { domain: "chart", path: ["mark", row.rowIndex] },
        x: row.x - w / 2,
        y: Math.min(row.y, baseline),
        w,
        h: Math.abs(baseline - row.y),
        fill: { color: seriesColor(seriesCategories, row.series) },
    }));
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

function buildLines(
    rows: ReadonlyArray<PositionedMark>,
    seriesCategories: ReadonlyArray<string> | undefined,
): SemanticNode[] {
    const series = new Map<string, PositionedMark[]>();
    for (const row of rows) {
        const key = row.series ?? "series";
        const bucket = series.get(key);
        if (bucket) bucket.push(row);
        else series.set(key, [row]);
    }

    const nodes: SemanticNode[] = [];
    for (const [name, rowsInSeries] of series) {
        const sorted = [...rowsInSeries].sort((a, b) => a.x - b.x || a.rowIndex - b.rowIndex);
        const commands: PathCommand[] = [
            { kind: "move", to: { x: sorted[0].x, y: sorted[0].y } },
            ...sorted.slice(1).map((row): PathCommand => ({ kind: "line", to: { x: row.x, y: row.y } })),
        ];
        nodes.push({
            kind: "path",
            id: `line:${name}`,
            role: "chart.mark",
            source: { domain: "chart", path: ["series", name] },
            path: { commands },
            stroke: { color: seriesColor(seriesCategories, name), width: LINE_STROKE_WIDTH },
        });
    }
    return nodes;
}

function buildPoints(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    seriesCategories: ReadonlyArray<string> | undefined,
): SemanticNode[] {
    return rows.map((row) => ({
        kind: "ellipse" as const,
        id: `${plan.spec.mark}:${row.rowIndex}`,
        role: "chart.mark" as const,
        source: { domain: "chart", path: ["mark", row.rowIndex] },
        cx: row.x,
        cy: row.y,
        rx: POINT_RADIUS,
        ry: POINT_RADIUS,
        fill: { color: seriesColor(seriesCategories, row.series) },
    }));
}

// ─── Guides: baselines, ticks, labels, legend ────────────────────────────

interface AxisTick {
    readonly label: string;
    readonly position: number;
}

/** One axis group: baseline + short tick marks + data-derived tick labels. */
function buildAxis(
    id: string,
    plot: PlotRect,
    scale: Scale,
    orientation: "horizontal" | "vertical",
): SemanticNode {
    const ticks = axisTicks(scale);
    const nodes: SemanticNode[] = [axisBaseline(id, plot, orientation)];

    if (orientation === "horizontal") {
        const baseline = plot.y + plot.h;
        ticks.forEach((tick, i) => {
            nodes.push(shortLine(`${id}:tick:${i}`, tick.position, baseline, tick.position, baseline + TICK_LENGTH));
            const height = estimateTextSize(tick.label, LABEL_FONT.sizePx).height;
            nodes.push(labelNode(`${id}:label:${i}`, tick.label, tick.position, baseline + TICK_LENGTH + height / 2));
        });
    } else {
        ticks.forEach((tick, i) => {
            nodes.push(shortLine(`${id}:tick:${i}`, plot.x - TICK_LENGTH, tick.position, plot.x, tick.position));
            const width = estimateTextSize(tick.label, LABEL_FONT.sizePx).width;
            const x = Math.max(width / 2 + 1, plot.x - TICK_LENGTH - LABEL_GAP - width / 2);
            nodes.push(labelNode(`${id}:label:${i}`, tick.label, x, tick.position));
        });
    }

    return { kind: "group", id, role: "chart.axis", children: nodes };
}

function axisBaseline(id: string, plot: PlotRect, orientation: "horizontal" | "vertical"): SemanticNode {
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
        stroke: AXIS_STROKE,
    };
}

function shortLine(id: string, x1: number, y1: number, x2: number, y2: number): SemanticNode {
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
        stroke: AXIS_STROKE,
    };
}

function labelNode(id: string, text: string, x: number, y: number): SemanticNode {
    return { kind: "text", id, role: "chart.axis", text, font: LABEL_FONT, anchor: { x, y }, color: LABEL_COLOR };
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
                .map((value) => ({ label: formatTick(value, 2), position: project(scale, value) }))
                .filter((tick) => Number.isFinite(tick.position));
        }
        case "linear": {
            const { values, decimals } = niceTicks(scale.domain);
            return values
                .map((value) => ({ label: formatTick(value, decimals), position: project(scale, value) }))
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

/** 4–6 evenly spaced "nice" values covering the domain (single value when flat). */
function niceTicks(domain: [number, number]): { values: number[]; decimals: number } {
    let [lo, hi] = domain;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { values: [], decimals: 0 };
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) {
        const single = normalizeNumber(lo);
        return { values: [single], decimals: decimalsForStep(Math.abs(single) || 1) };
    }

    const rawStep = (hi - lo) / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2.5 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    const decimals = decimalsForStep(step);

    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    const values: number[] = [];
    for (let i = first; i <= last && values.length < MAX_TICKS; i++) {
        values.push(normalizeNumber(i * step));
    }
    if (values.length === 0) values.push(normalizeNumber((lo + hi) / 2));
    return { values, decimals };
}

function decimalsForStep(step: number): number {
    if (!(step > 0) || !Number.isFinite(step)) return 0;
    let decimals = 0;
    while (decimals < MAX_TICK_DECIMALS && Math.abs(Number(step.toFixed(decimals)) - step) > step * 1e-6) {
        decimals += 1;
    }
    return decimals;
}

function formatTick(value: number, decimals: number): string {
    if (!Number.isFinite(value)) return "";
    const places = Math.min(Math.max(decimals, 0), MAX_TICK_DECIMALS);
    let text = value.toFixed(places);
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text === "-0" ? "0" : text;
}

/** Kill floating point tails such as 0.30000000000000004. */
function normalizeNumber(value: number): number {
    return Number(value.toPrecision(12));
}

/** Color swatches live in the plot's upper-right corner, clear of the ticks. */
function buildLegend(plan: ChartCompilePlan, plot: PlotRect): SemanticNode[] {
    const enc = plan.spec.encoding.find((e) => e.channel === "color" || e.channel === "series");
    if (!enc) return [];
    const col = column(plan.resolvedData, enc.field);
    if (!col) return [];
    const categories = collectCategories(col);
    if (categories.length === 0) return [];

    const size = LEGEND_FONT.sizePx;
    const widths = categories.map((category) => estimateTextSize(category, size).width);
    const blockWidth = LEGEND_SWATCH + LEGEND_SWATCH_GAP + Math.max(...widths);
    const right = plot.x + plot.w - LEGEND_EDGE_GAP;
    const left = Math.max(plot.x + LEGEND_EDGE_GAP, right - blockWidth);
    const capacity = Math.max(1, Math.floor((plot.h - LEGEND_EDGE_GAP * 2) / LEGEND_ITEM_STEP));

    const items: SemanticNode[] = [];
    categories.slice(0, capacity).forEach((category, i) => {
        // Use the same palette index as `seriesColor` so legend swatches match
        // mark colors one-for-one.
        const color = LEGEND_PALETTE[seriesPaletteIndex(categories, category) % LEGEND_PALETTE.length];
        const top = plot.y + LEGEND_EDGE_GAP + i * LEGEND_ITEM_STEP;
        items.push({
            kind: "rect",
            id: `legend:swatch:${i}`,
            role: "chart.legend",
            x: left,
            y: top + (LEGEND_ITEM_STEP - LEGEND_SWATCH) / 2,
            w: LEGEND_SWATCH,
            h: LEGEND_SWATCH,
            rx: 1,
            ry: 1,
            fill: { color },
        });
        items.push({
            kind: "text",
            id: `legend:label:${i}`,
            role: "chart.legend",
            text: category,
            font: LEGEND_FONT,
            anchor: { x: left + LEGEND_SWATCH + LEGEND_SWATCH_GAP + widths[i] / 2, y: top + LEGEND_ITEM_STEP / 2 },
            color: LABEL_COLOR,
        });
    });

    return [{ kind: "group", id: "chart-legend", role: "chart.legend", children: items }];
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

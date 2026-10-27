// Chart scene builder — ChartCompilePlan + viewport → SemanticScene.
//
// The compile plan carries scales with a host-independent range (linear stays
// in [0, 1], band uses one step per category). This module is the only place
// that turns those ranges into pixels, so `compile` never guesses a viewport.
// It emits mark geometry only — no theme, motion, interaction state or guides.
//
// Node identity comes from `rowIndex` (bar / point) or the series value (line),
// never from the position of an item in a temporary array.

import { rgb8, type PathCommand, type RGBA } from "@doki-land/davinci-types";
import type { SemanticNode, SemanticScene } from "@doki-land/davinci-scene";
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
const MARK_FILL: RGBA = rgb8(51, 51, 51);
const LINE_STROKE = { color: MARK_FILL, width: 2 };
const POINT_RADIUS = 3;
const BAR_RATIO = 0.8;

/** Build a SemanticScene from a ChartCompilePlan and a pixel viewport. */
export function buildScene(plan: ChartCompilePlan, viewport: ChartViewport): SemanticScene {
    const plot = plotRect(viewport);
    const children: SemanticNode[] = [];

    const xEnc = plan.spec.encoding.find((e) => e.channel === "x");
    const yEnc = plan.spec.encoding.find((e) => e.channel === "y");
    const seriesEnc = plan.spec.encoding.find(
        (e) => e.channel === "series" || e.channel === "color" || e.channel === "group",
    );

    if (xEnc && yEnc && plot.w > 0 && plot.h > 0) {
        const xScale = pixelScale(plan.scales.get(xEnc.channel), [plot.x, plot.x + plot.w]);
        const yScale = pixelScale(plan.scales.get(yEnc.channel), [plot.y + plot.h, plot.y]);
        const xCol = column(plan.resolvedData, xEnc.field);
        const yCol = column(plan.resolvedData, yEnc.field);
        const seriesCol = seriesEnc ? column(plan.resolvedData, seriesEnc.field) : undefined;

        if (xScale && yScale && xCol && yCol) {
            const rows = positionedRows(plan, xScale, yScale, xCol, yCol, seriesCol);
            children.push(...buildMarks(plan, rows, plot, xScale));
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
): SemanticNode[] {
    switch (plan.spec.mark) {
        case "bar":
        case "rect":
            return buildBars(plan, rows, plot, xScale);
        case "line":
            return buildLines(rows);
        case "point":
        case "circle":
            return buildPoints(plan, rows);
        default:
            // Other mark families (area / text / tick) are not lowered yet.
            return [];
    }
}

function buildBars(
    plan: ChartCompilePlan,
    rows: ReadonlyArray<PositionedMark>,
    plot: PlotRect,
    xScale: Scale,
): SemanticNode[] {
    const bandWidth = xScale.kind === "band" ? bandwidth(xScale) : 0;
    const step = bandWidth > 0 ? bandWidth : plot.w / Math.max(1, rows.length);
    const w = step * BAR_RATIO;
    const baseline = plot.y + plot.h;

    return rows.map((row) => ({
        kind: "rect" as const,
        id: `${plan.spec.mark}:${row.rowIndex}`,
        role: "chart.mark" as const,
        source: { domain: "chart", path: ["mark", row.rowIndex] },
        x: row.x - w / 2,
        y: Math.min(row.y, baseline),
        w,
        h: Math.abs(baseline - row.y),
        fill: { color: MARK_FILL },
    }));
}

function buildLines(rows: ReadonlyArray<PositionedMark>): SemanticNode[] {
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
            stroke: LINE_STROKE,
        });
    }
    return nodes;
}

function buildPoints(plan: ChartCompilePlan, rows: ReadonlyArray<PositionedMark>): SemanticNode[] {
    return rows.map((row) => ({
        kind: "ellipse" as const,
        id: `${plan.spec.mark}:${row.rowIndex}`,
        role: "chart.mark" as const,
        source: { domain: "chart", path: ["mark", row.rowIndex] },
        cx: row.x,
        cy: row.y,
        rx: POINT_RADIUS,
        ry: POINT_RADIUS,
        fill: { color: MARK_FILL },
    }));
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

function plotRect(viewport: ChartViewport): PlotRect {
    const p = paddingOf(viewport.padding);
    const width = dimension(viewport.width);
    const height = dimension(viewport.height);
    return {
        x: p.left,
        y: p.top,
        w: Math.max(0, width - p.left - p.right),
        h: Math.max(0, height - p.top - p.bottom),
    };
}

function paddingOf(padding: number | Partial<ScenePadding> | undefined): ScenePadding {
    if (typeof padding === "number" && Number.isFinite(padding)) {
        return { top: padding, right: padding, bottom: padding, left: padding };
    }
    const sides = typeof padding === "object" && padding ? padding : {};
    return {
        top: sides.top ?? DEFAULT_PADDING,
        right: sides.right ?? DEFAULT_PADDING,
        bottom: sides.bottom ?? DEFAULT_PADDING,
        left: sides.left ?? DEFAULT_PADDING,
    };
}

function dimension(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

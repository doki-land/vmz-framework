// Chart theme — presentation tokens resolved before the scene builder.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §4 — the renderer
// never picks colors or themes; the chart domain resolves tokens into the
// SemanticScene, so browser, SSR and static export share one mapping.

import { rgb8, type FontSpec, type RGBA } from "@doki-land/davinci-types";

/** Presentation tokens `buildScene` consumes. */
export interface ChartTheme {
    /** Categorical palette for grouped marks. The index of a series follows
     *  its position in `ChartCompilePlan.series.categories` (first-appearance
     *  order) and wraps around, so every series is visually distinct up to
     *  the palette length. */
    readonly seriesPalette: ReadonlyArray<RGBA>;
    /** Fill for ungrouped marks (no series / color / group encoding). */
    readonly markFill: RGBA;
    /** Axis baseline and tick stroke. */
    readonly axisStroke: RGBA;
    readonly axisStrokeWidth: number;
    /** Tick and legend label color. */
    readonly labelColor: RGBA;
    /** Tick label font — also drives padding and truncation widths. */
    readonly labelFont: FontSpec;
    /** Legend label font. */
    readonly legendFont: FontSpec;
}

/** The reference neutral theme — the values the builder hardcoded before
 *  themes existed, kept as defaults so unstyled output is unchanged. */
export const DEFAULT_CHART_THEME: ChartTheme = {
    seriesPalette: [
        rgb8(31, 119, 180),
        rgb8(255, 127, 14),
        rgb8(44, 160, 44),
        rgb8(214, 39, 40),
        rgb8(148, 103, 189),
        rgb8(140, 86, 75),
    ],
    markFill: rgb8(51, 51, 51),
    axisStroke: rgb8(160, 160, 160),
    axisStrokeWidth: 1,
    labelColor: rgb8(85, 85, 85),
    labelFont: { family: "sans-serif", sizePx: 11 },
    legendFont: { family: "sans-serif", sizePx: 11 },
};

// Chart theme — presentation tokens resolved before the scene builder.
// The renderer never picks colors or themes; the chart domain resolves
// tokens into the SemanticScene, so browser, SSR and static export share
// one mapping.

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
    /** Optional caller-supplied category → color map (treemap groups and
     *  categorical marks keyed by a `color` field). Categories missing from
     *  the map fall back to `seriesPalette`, indexed by sorted category order
     *  so reordering rows never recolors a node. */
    readonly categoryColors?: ReadonlyMap<string, RGBA>;
    /** Axis baseline and tick stroke. */
    readonly axisStroke: RGBA;
    readonly axisStrokeWidth: number;
    /** Grid line stroke — lighter than the axis so data stays on top of the
     *  visual hierarchy. `null` disables grid emission. */
    readonly gridStroke: RGBA | null;
    readonly gridStrokeWidth: number;
    /** Tick and legend label color. */
    readonly labelColor: RGBA;
    /** Tick label font — also drives padding and truncation widths. */
    readonly labelFont: FontSpec;
    /** Legend label font. */
    readonly legendFont: FontSpec;
    /** Stroke painted around point marks so overlapping glyphs stay
     *  separable; usually the plot background color. `null` disables it. */
    readonly pointStroke: RGBA | null;
    /** Opacity of the area-mark fill (the stroke keeps full strength). */
    readonly areaFillOpacity: number;
    /** Sequential ramp for value→color marks (heatmap): ≥2 stops, sampled at
     *  t ∈ [0, 1] from the data minimum to the maximum. */
    readonly heatmapRamp: ReadonlyArray<RGBA>;
    /** Rising fill for candlestick bodies and waterfall positive deltas. */
    readonly upColor: RGBA;
    /** Falling fill for candlestick bodies and waterfall negative deltas. */
    readonly downColor: RGBA;
    /** Unfilled track ring / sweep color for gauge and radial-bar marks. */
    readonly trackColor: RGBA;
    /** Qualitative band tints for bullet charts, poor → good. */
    readonly rangeTints: readonly [RGBA, RGBA, RGBA];
    /** Opacity of sankey link ribbons (nodes stay at full strength). */
    readonly sankeyLinkOpacity: number;
}

const LABEL_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/** The reference light theme — VMZ brand blue anchors the categorical
 *  palette, grids stay quieter than axes, and axes stay quieter than data. */
export const DEFAULT_CHART_THEME: ChartTheme = {
    seriesPalette: [
        rgb8(22, 119, 255), // VMZ brand blue
        rgb8(245, 158, 11), // amber
        rgb8(16, 185, 129), // emerald
        rgb8(239, 68, 68), // red
        rgb8(139, 92, 246), // violet
        rgb8(236, 72, 153), // pink
        rgb8(20, 184, 166), // teal
        rgb8(249, 115, 22), // orange
    ],
    markFill: rgb8(22, 119, 255),
    axisStroke: rgb8(156, 163, 175),
    axisStrokeWidth: 1,
    gridStroke: rgb8(229, 231, 235),
    gridStrokeWidth: 1,
    labelColor: rgb8(75, 85, 99),
    labelFont: { family: LABEL_FAMILY, sizePx: 12 },
    legendFont: { family: LABEL_FAMILY, sizePx: 12 },
    pointStroke: rgb8(255, 255, 255),
    areaFillOpacity: 0.25,
    heatmapRamp: [rgb8(239, 246, 255), rgb8(191, 219, 254), rgb8(96, 165, 250), rgb8(37, 99, 235), rgb8(30, 58, 138)],
    upColor: rgb8(16, 185, 129),
    downColor: rgb8(239, 68, 68),
    trackColor: rgb8(229, 231, 235),
    rangeTints: [rgb8(229, 231, 235), rgb8(209, 213, 219), rgb8(156, 163, 175)],
    sankeyLinkOpacity: 0.35,
};

/** Dark theme — same palette roles with lifted brightness and quiet chrome. */
export const DARK_CHART_THEME: ChartTheme = {
    seriesPalette: [
        rgb8(96, 165, 250), // blue-400
        rgb8(251, 191, 36), // amber-400
        rgb8(52, 211, 153), // emerald-400
        rgb8(248, 113, 113), // red-400
        rgb8(167, 139, 250), // violet-400
        rgb8(244, 114, 182), // pink-400
        rgb8(45, 212, 191), // teal-400
        rgb8(251, 146, 60), // orange-400
    ],
    markFill: rgb8(96, 165, 250),
    axisStroke: rgb8(107, 114, 128),
    axisStrokeWidth: 1,
    gridStroke: rgb8(55, 65, 81),
    gridStrokeWidth: 1,
    labelColor: rgb8(209, 213, 219),
    labelFont: { family: LABEL_FAMILY, sizePx: 12 },
    legendFont: { family: LABEL_FAMILY, sizePx: 12 },
    pointStroke: rgb8(17, 24, 39),
    areaFillOpacity: 0.3,
    heatmapRamp: [rgb8(12, 30, 62), rgb8(30, 58, 138), rgb8(37, 99, 235), rgb8(96, 165, 250), rgb8(191, 219, 254)],
    upColor: rgb8(52, 211, 153),
    downColor: rgb8(248, 113, 113),
    trackColor: rgb8(55, 65, 81),
    rangeTints: [rgb8(31, 41, 55), rgb8(55, 65, 81), rgb8(75, 85, 99)],
    sankeyLinkOpacity: 0.4,
};

// Chart compile — ChartSpec + DataSnapshot → ChartCompilePlan.
//
// ChartCompilePlan is the resolved stage between domain spec and scene. It
// contains fully-instantiated scales, resolved encodings, one row per mark
// (after statistics / faceting) plus the diagnostics raised while reading the
// data. The plan does NOT carry scene shapes — those are produced by the scene
// builder.

import { diag, type Diagnostic, type DiagnosticSet } from "@doki-land/davinci-types";
import { column, fromRows, type DataColumn, type DataSnapshot } from "./data.js";
import { geoMapById, type GeoFeature } from "./geo.js";
import { apply as scaleApply, niceLinearTicks, type Scale } from "./scale.js";
import { binValues, boxStats, kde, rankDescending, silvermanBandwidth } from "./statistic.js";

/** Mark kind (geometric primitive family). Only marks with real scene
 *  geometry are listed — an authoring surface can never name a mark the
 *  engine would silently drop. */
export type MarkKind =
    | "point"
    | "line"
    | "rect"
    | "bar"
    | "circle"
    | "area"
    | "pie"
    | "radar"
    | "heatmap"
    | "candlestick"
    | "boxplot"
    | "histogram"
    | "waterfall"
    | "funnel"
    | "gauge"
    | "sankey"
    | "treemap"
    | "ridgeline"
    | "bump"
    | "slope"
    | "rose"
    | "radial-bar"
    | "bullet"
    | "violin"
    | "streamgraph"
    | "mosaic"
    | "calendar"
    | "sunburst"
    | "dumbbell"
    | "lollipop"
    | "strip"
    | "beeswarm"
    | "gantt"
    | "tree"
    | "force"
    | "parallel"
    | "hexbin"
    | "contour"
    | "chord"
    | "geo";

/** Encoding channel — how a data field maps to a visual property. */
export interface EncodingChannel {
    /** Field name in DataSnapshot. */
    readonly field: string;
    /** Visual channel: x, y, color, size, shape, opacity, text... */
    readonly channel: string;
}

/** Chart authoring spec (Vega-Lite-lite). */
export interface ChartSpec {
    readonly mark: MarkKind;
    readonly encoding: ReadonlyArray<EncodingChannel>;
    /** Optional explicit scale overrides. */
    readonly scales?: ReadonlyMap<string, Scale>;
    /** Facet field (optional — the scene builder lays out one small-multiple
     *  panel per facet value, sharing scales across panels). */
    readonly facetField?: string;
    /** How grouped (series) marks share the x slot. `undefined` is the
     *  natural per-mark default: `bar`/`rect` dodge side by side, everything
     *  else overlaps. `stack` accumulates positive and negative values
     *  separately from the zero baseline (bars and areas only). `percent`
     *  normalizes each x slot's stack into a shared 0–100 percent domain
     *  (bars and areas only, negative values are dropped with a warning). */
    readonly seriesLayout?: "overlap" | "stack" | "dodge" | "percent";
    /** Pie only: inner radius as a fraction of the outer radius (0 = pie,
     *  0.55–0.75 reads as a donut). */
    readonly innerRadiusRatio?: number;
    /** Field whose value names each row. Marks carry this key as identity, so
     *  re-sorting or filtering rows never renumbers them. Without `keyField`
     *  keys are positional (`"0"`, `"1"`, …) and only stable while the row
     *  order is. */
    readonly keyField?: string;
    /** Treemap only: field naming each row's parent id (`keyField` names the
     *  row's own id). Rows whose parent is absent or unknown hang at the
     *  root level with a warning. */
    readonly parentField?: string;
    /** Treemap only: how many levels get their own rect. The document root
     *  (or, when drilled, the drill root's direct children) is level 1.
     *  Omitted means every level is drawn. */
    readonly treemapDepth?: number;
    /** Treemap only: rects smaller than this many px² are omitted instead of
     *  painted as invisible slivers. Defaults to 4 px² and always keeps the
     *  largest item of a level, so a level never vanishes entirely. */
    readonly treemapMinArea?: number;
    /** Treemap only: id of the node rendered as the root — the drill-down
     *  surface. An unknown id raises a diagnostic and the chart stays at the
     *  document root. */
    readonly treemapRoot?: string;
    /** Gauge only: the [min, max] the sweep spans; defaults to [0, 100]. */
    readonly valueDomain?: readonly [number, number];
    /** Sparkline mode: strip axes, grid and legend for tiny inline charts. */
    readonly spark?: boolean;
    /** Tree only: layout variant. `tidy` (default) packs parents over their
     *  children; `dendrogram` aligns every leaf on the deepest column;
     *  `radial` maps depth to radius and leaf order to angle. */
    readonly treeLayout?: "tidy" | "dendrogram" | "radial";
    /** Parallel coordinates only: ordered quantitative fields, one axis per
     *  entry. This is the multi-axis authoring surface — encodings only carry
     *  the optional `color` series. */
    readonly dimensions?: ReadonlyArray<string>;
    /** Geo choropleth only: basemap resource id (registered by the host) and
     *  the projection to fit it with. */
    readonly geo?: {
        readonly map: string;
        readonly projection: "mercator" | "equirectangular" | "albers";
    };
}

/** Series (grouping) domain resolved once by `compile`. */
export interface SeriesDomain {
    /** Encoding field that groups marks, or null when ungrouped. */
    readonly field: string | null;
    /** Group values in first-appearance order — legend and palette share it. */
    readonly categories: ReadonlyArray<string>;
}

/** One resolved mark instance in the plan — will become one Scene node. */
export interface PlanMark {
    /** Row index in the resolved data. */
    readonly rowIndex: number;
    /** Stable row identity — `keyField` value, or the row index as a string.
     *  Duplicated keys are disambiguated with a `~rowIndex` suffix and
     *  reported as `davinci.chart.duplicate-key`. */
    readonly key: string;
    /** Series group this row belongs to (stringified), null when ungrouped. */
    readonly series: string | null;
    /** Encoded channel values (scale-applied). */
    readonly channels: ReadonlyMap<string, number | string>;
    /** Stacked layout only: the data-unit baseline this mark starts from
     *  (cumulative sum of same-sign values below it in its x slot). */
    readonly stackBase?: number;
}

/** Full compile plan — scene builder consumes this. */
export interface ChartCompilePlan {
    readonly spec: ChartSpec;
    readonly resolvedData: DataSnapshot;
    readonly scales: ReadonlyMap<string, Scale>;
    readonly marks: ReadonlyArray<PlanMark>;
    /** Resolved grouping domain — the scene never re-reads the series column. */
    readonly series: SeriesDomain;
    /** Statistic snapshot produced at compile time (histogram bins, boxplot
     *  five-number summaries, ridgeline density grid). Marks of stat-driven
     *  kinds index into THIS snapshot; `null` for marks that position raw
     *  rows. The scene and hosts read it as data, never recompute it. */
    readonly stat: DataSnapshot | null;
    /** Data problems found while compiling — row-level, never fatal to the host. */
    readonly diagnostics: DiagnosticSet;
}

/** Encoding channels that group marks into series. */
const seriesChannels: ReadonlySet<string> = new Set(["series", "color", "group"]);

/** Mark kinds measured from a zero baseline. */
const zeroBasedMarks: ReadonlySet<MarkKind> = new Set(["bar", "rect", "area", "radar", "bullet", "rose", "lollipop"]);

/** Channels whose value decides whether a row can be positioned at all. */
const basePositionChannels: ReadonlySet<string> = new Set(["x", "y", "theta"]);

/** Extra channels a mark requires for a row to be drawable at all. */
const markRequiredChannels: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
    ["candlestick", ["open", "high", "low", "close"]],
    ["heatmap", ["color"]],
    ["sankey", ["source", "target", "value"]],
    ["treemap", ["size"]],
    ["sunburst", ["size"]],
    ["bullet", ["target"]],
    ["calendar", ["color"]],
    ["dumbbell", ["yEnd"]],
    ["gantt", ["start", "end"]],
    ["force", ["source", "target"]],
    ["chord", ["source", "target", "value"]],
]);

/** Mark kinds whose `color` encoding is a quantitative value channel, not a
 *  series grouping (heatmap, calendar and geo cells read color as data). */
const colorAsValueMarks: ReadonlySet<string> = new Set(["heatmap", "calendar", "geo"]);

/** Mark kinds whose legend / palette comes from a positional category field
 *  instead of a series encoding: ridgeline ridges and rose / radial-bar /
 *  funnel categories are colored per category. */
const categorySeriesField: ReadonlyMap<string, string> = new Map([
    ["ridgeline", "y"],
    ["rose", "x"],
    ["radial-bar", "x"],
    ["funnel", "x"],
]);

/** Marks whose statistics or shared offsets are computed globally — faceting
 *  them would need per-panel statistics, which is a separate contract. */
const statDrivenMarks: ReadonlySet<string> = new Set([
    "histogram",
    "boxplot",
    "ridgeline",
    "bump",
    "violin",
    "calendar",
    "streamgraph",
    "mosaic",
    "force",
    "hexbin",
    "contour",
    "chord",
]);

/** Encoding channels each mark needs before any row can position. */
const markEncodingNeeds: Readonly<Record<string, ReadonlyArray<string>>> = {
    heatmap: ["x", "y", "color"],
    candlestick: ["x", "open", "high", "low", "close"],
    boxplot: ["x", "y"],
    histogram: ["x"],
    waterfall: ["x", "y"],
    funnel: ["x", "y"],
    gauge: ["theta"],
    sankey: ["source", "target", "value"],
    treemap: ["size"],
    ridgeline: ["x", "y"],
    bump: ["x", "y"],
    slope: ["x", "y"],
    rose: ["x", "y"],
    "radial-bar": ["x", "y"],
    bullet: ["x", "y", "target"],
    violin: ["x", "y"],
    streamgraph: ["x", "y"],
    mosaic: ["x", "y", "color"],
    calendar: ["x", "color"],
    sunburst: ["size"],
    dumbbell: ["x", "y", "yEnd"],
    lollipop: ["x", "y"],
    strip: ["x", "y"],
    beeswarm: ["y"],
    gantt: ["y", "start", "end"],
    force: ["source", "target"],
    hexbin: ["x", "y"],
    contour: ["x", "y"],
    chord: ["source", "target", "value"],
    geo: ["region", "color"],
};

/** Mark kinds with real scene geometry. Kept in sync with the scene
 *  builder; `compile` refuses anything else instead of rendering an empty
 *  chart with no explanation. */
const implementedMarks: ReadonlySet<string> = new Set([
    "bar",
    "rect",
    "line",
    "point",
    "circle",
    "area",
    "pie",
    "radar",
    "heatmap",
    "candlestick",
    "boxplot",
    "histogram",
    "waterfall",
    "funnel",
    "gauge",
    "sankey",
    "treemap",
    "ridgeline",
    "bump",
    "slope",
    "rose",
    "radial-bar",
    "bullet",
    "violin",
    "streamgraph",
    "mosaic",
    "calendar",
    "sunburst",
    "dumbbell",
    "lollipop",
    "strip",
    "beeswarm",
    "gantt",
    "tree",
    "force",
    "parallel",
    "hexbin",
    "contour",
    "chord",
    "geo",
]);

/** Resolve the effective series layout. `undefined` is the natural per-mark
 *  default: grouped bars dodge, everything else overlaps. */
export function resolveSeriesLayout(spec: ChartSpec, hasSeries: boolean): "overlap" | "stack" | "dodge" | "percent" {
    if (!hasSeries) return "overlap";
    if (spec.seriesLayout) return spec.seriesLayout;
    return spec.mark === "bar" || spec.mark === "rect" ? "dodge" : "overlap";
}

/** Compile a ChartSpec against a DataSnapshot. */
export function compile(spec: ChartSpec, data: DataSnapshot): ChartCompilePlan {
    const scales = new Map<string, Scale>();
    const marks: PlanMark[] = [];
    const diagnostics: Diagnostic[] = [];

    // An unimplemented mark must never degrade into a silent empty chart —
    // refuse it as an authoring error up front.
    if (!implementedMarks.has(spec.mark)) {
        diagnostics.push(
            diag(
                "error",
                "davinci.chart.unsupported-mark",
                `mark "${String(spec.mark)}" has no scene geometry; implemented marks are ${[...implementedMarks].join(", ")}`,
                String(spec.mark),
            ),
        );
    }

    // Mark-aware encoding requirements: every listed channel must be named by
    // an encoding, otherwise the mark cannot position rows at all.
    const neededChannels = markEncodingNeeds[spec.mark as string];
    if (neededChannels) {
        for (const channel of neededChannels) {
            if (!spec.encoding.some((e) => e.channel === channel)) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.missing-encoding",
                        `mark "${String(spec.mark)}" needs a "${channel}" encoding channel`,
                        channel,
                    ),
                );
            }
        }
    }

    // Resolve the grouping domain once: first-appearance category order is a
    // contract (legend and palette index marks by it), so it is computed here,
    // not re-derived by the scene builder. Heatmap reads `color` as a
    // quantitative value, not a grouping; ridgeline / rose / radial-bar /
    // funnel take their legend categories from a positional field instead.
    const seriesEnc = spec.encoding.find(
        (e) => seriesChannels.has(e.channel) && !(colorAsValueMarks.has(spec.mark) && e.channel === "color"),
    );
    const categoryChannel = categorySeriesField.get(spec.mark);
    const categoryEnc = seriesEnc ? undefined : spec.encoding.find((e) => e.channel === categoryChannel);
    const legendEnc = seriesEnc ?? categoryEnc;
    const legendCol = legendEnc ? column(data, legendEnc.field) : undefined;
    const seriesCategories: string[] = [];
    if (legendCol) {
        const seenSeries = new Set<string>();
        for (const v of legendCol.values) {
            if (v === null || v === undefined) continue;
            if (typeof v === "number" && !Number.isFinite(v)) continue;
            const key = String(v);
            if (!seenSeries.has(key)) {
                seenSeries.add(key);
                seriesCategories.push(key);
            }
        }
    }

    // Resolve row identity. A declared keyField that is absent is the same
    // class of authoring mistake as an unknown encoding field.
    let keyCol: ReturnType<typeof column> = undefined;
    if (spec.keyField) {
        keyCol = column(data, spec.keyField);
        if (!keyCol && data.columns.length > 0) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.unknown-field",
                    `keyField "${spec.keyField}" is not in the data`,
                    spec.keyField,
                ),
            );
        }
    }
    const usedKeys = new Set<string>();

    // The facet field is read by the scene builder when panels are laid out;
    // an unknown facet field is the same class of authoring mistake as an
    // unknown encoding or key field. Missing cells warn — those rows never
    // reach a panel.
    if (spec.facetField) {
        const facetCol = column(data, spec.facetField);
        if (!facetCol && data.columns.length > 0) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.unknown-field",
                    `facetField "${spec.facetField}" is not in the data`,
                    spec.facetField,
                ),
            );
        }
        if (facetCol) {
            let missing = 0;
            for (const v of facetCol.values) {
                if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) missing += 1;
            }
            if (missing > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.missing-facet-value",
                        `facetField "${spec.facetField}" has no usable value for ${missing} row${missing === 1 ? "" : "s"}; they appear in no panel`,
                        spec.facetField,
                    ),
                );
            }
        }
    }

    // ── Series layout pre-pass (stack offsets live in the plan, geometry in
    // the scene builder) ─────────────────────────────────────────────────
    const layout = resolveSeriesLayout(spec, legendCol !== undefined);
    if (spec.mark === "pie") {
        const thetaEnc = spec.encoding.find((e) => e.channel === "theta");
        if (!thetaEnc) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.pie-needs-theta",
                    `pie marks need a "theta" encoding channel naming the value field`,
                    "theta",
                ),
            );
        }
        const ratio = spec.innerRadiusRatio ?? 0;
        if (!Number.isFinite(ratio) || ratio < 0 || ratio >= 1) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.invalid-inner-radius",
                    `innerRadiusRatio must be a finite number in [0, 1), got ${String(spec.innerRadiusRatio)}`,
                    "innerRadiusRatio",
                ),
            );
        }
    }
    if (spec.seriesLayout && !legendCol) {
        diagnostics.push(
            diag(
                "info",
                "davinci.chart.layout-without-series",
                `seriesLayout "${spec.seriesLayout}" needs a color / series / group channel and is ignored without one`,
                spec.seriesLayout,
            ),
        );
    }
    if (spec.mark === "radar") {
        // A radar web needs at least three spokes to read as a shape — one or
        // two dimensions draw a degenerate fan, so say so instead of
        // rendering a confusing chart.
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        if (xCol) {
            const dims = new Set<string>();
            for (const v of xCol.values) {
                if (v === null || v === undefined) continue;
                if (typeof v === "number" && !Number.isFinite(v)) continue;
                dims.add(String(v));
            }
            if (dims.size > 0 && dims.size < 3) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.radar-few-dimensions",
                        `radar reads as a shape with at least 3 dimensions, got ${dims.size}`,
                        xEnc?.field,
                    ),
                );
            }
        }
    }
    if (layout === "stack" && spec.mark !== "bar" && spec.mark !== "rect" && spec.mark !== "area") {
        diagnostics.push(
            diag(
                "error",
                "davinci.chart.unsupported-layout",
                `seriesLayout "stack" is only meaningful for bar, rect and area marks, not "${String(spec.mark)}"`,
                String(spec.mark),
            ),
        );
    }
    if (layout === "dodge" && spec.mark !== "bar" && spec.mark !== "rect") {
        diagnostics.push(
            diag(
                "info",
                "davinci.chart.layout-ignored",
                `seriesLayout "dodge" only affects bar / rect marks and is ignored for "${String(spec.mark)}"`,
                String(spec.mark),
            ),
        );
    }

    /** Stacked baseline per row in data units (same-sign cumulative). */
    let stackOffsets: Map<number, number> | null = null;
    /** Stacked y extent [lo, hi] across all x slots. */
    let stackExtent: [number, number] | null = null;
    const stackable = spec.mark === "bar" || spec.mark === "rect" || spec.mark === "area";
    if (layout === "stack" && stackable) {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol && legendCol) {
            stackOffsets = new Map();
            let hi = 0;
            let lo = 0;
            const byX = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                if (xv === null || xv === undefined) continue;
                const key = String(xv);
                const bucket = byX.get(key);
                if (bucket) bucket.push(r);
                else byX.set(key, [r]);
            }
            for (const rows of byX.values()) {
                let pos = 0;
                let neg = 0;
                // Stack in series first-appearance order so the visual order
                // matches the legend exactly.
                for (const category of seriesCategories) {
                    for (const r of rows) {
                        const cell = legendCol.values[r];
                        if (cell === null || cell === undefined || String(cell) !== category) continue;
                        const v = yCol.values[r];
                        if (typeof v !== "number" || !Number.isFinite(v)) continue;
                        if (v >= 0) {
                            stackOffsets.set(r, pos);
                            pos += v;
                        } else {
                            stackOffsets.set(r, neg);
                            neg += v;
                        }
                    }
                }
                if (pos > hi) hi = pos;
                if (neg < lo) lo = neg;
            }
            stackExtent = [lo, hi];
        }
    }

    // ── Mark-aware structure checks and statistic pre-passes ────────────────
    // Statistics live ONLY here: binning, five-number summaries, KDE, ranks,
    // waterfall offsets and hierarchy sums are computed once and materialized
    // into `stat` snapshots or mark channels. The scene builder never recomputes.

    // Faceting re-runs no statistics — combining it with stat-driven marks
    // would silently show global statistics per panel.
    if (spec.facetField && statDrivenMarks.has(spec.mark)) {
        diagnostics.push(
            diag(
                "error",
                "davinci.chart.facet-stat-unsupported",
                `facetField cannot combine with "${String(spec.mark)}": its statistics are computed globally, not per panel`,
                spec.facetField,
            ),
        );
    }

    // Slope charts connect exactly two x positions; anything else draws a
    // misleading line.
    if (spec.mark === "slope") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        if (xCol) {
            const xs = new Set<string>();
            for (const v of xCol.values) {
                if (v === null || v === undefined) continue;
                if (typeof v === "number" && !Number.isFinite(v)) continue;
                xs.add(String(v));
            }
            if (xs.size > 0 && xs.size !== 2) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.slope-needs-two-x",
                        `slope connects exactly two x positions, got ${xs.size}`,
                        xEnc?.field,
                    ),
                );
            }
        }
    }

    // Gauge reads one value against a domain; extra rows would be invisible.
    if (spec.mark === "gauge") {
        const thetaEnc = spec.encoding.find((e) => e.channel === "theta");
        const thetaCol = thetaEnc ? column(data, thetaEnc.field) : undefined;
        if (thetaCol) {
            const usable = thetaCol.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).length;
            if (usable > 1) {
                diagnostics.push(
                    diag(
                        "info",
                        "davinci.chart.gauge-single-value",
                        `gauge reads the first usable row, ${usable - 1} more row${usable === 2 ? "" : "s"} ignored`,
                        thetaEnc?.field,
                    ),
                );
            }
        }
        const vd = spec.valueDomain;
        if (vd && (!Number.isFinite(vd[0]) || !Number.isFinite(vd[1]) || vd[0] >= vd[1])) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.invalid-value-domain",
                    `valueDomain must be a finite [min, max] with min < max, got [${String(vd[0])}, ${String(vd[1])}]`,
                    "valueDomain",
                ),
            );
        }
    }

    // Sankey flows form a DAG — a cycle has no layered layout. Kahn's
    // algorithm leaves exactly the cyclic nodes unvisited.
    if (spec.mark === "sankey") {
        const sEnc = spec.encoding.find((e) => e.channel === "source");
        const tEnc = spec.encoding.find((e) => e.channel === "target");
        const vEnc = spec.encoding.find((e) => e.channel === "value");
        const sCol = sEnc ? column(data, sEnc.field) : undefined;
        const tCol = tEnc ? column(data, tEnc.field) : undefined;
        const vCol = vEnc ? column(data, vEnc.field) : undefined;
        if (sCol && tCol && vCol) {
            const nodes = new Set<string>();
            const out = new Map<string, string[]>();
            const indegree = new Map<string, number>();
            for (let r = 0; r < data.rowCount; r++) {
                const s = sCol.values[r];
                const t = tCol.values[r];
                const v = vCol.values[r];
                if (s === null || s === undefined || t === null || t === undefined) continue;
                if (typeof v !== "number" || !Number.isFinite(v)) continue;
                const source = String(s);
                const target = String(t);
                nodes.add(source);
                nodes.add(target);
                if (source === target) {
                    diagnostics.push(
                        diag("error", "davinci.chart.sankey-cycle", `sankey link "${source}" loops onto itself`, source),
                    );
                    continue;
                }
                const list = out.get(source);
                if (list) list.push(target);
                else out.set(source, [target]);
                indegree.set(target, (indegree.get(target) ?? 0) + 1);
                if (!indegree.has(source)) indegree.set(source, 0);
            }
            const queue = [...nodes].filter((n) => (indegree.get(n) ?? 0) === 0);
            let visited = 0;
            while (queue.length > 0) {
                const n = queue.pop()!;
                visited++;
                for (const next of out.get(n) ?? []) {
                    const d = (indegree.get(next) ?? 0) - 1;
                    indegree.set(next, d);
                    if (d === 0) queue.push(next);
                }
            }
            if (visited < nodes.size) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.sankey-cycle",
                        `sankey links form a cycle involving ${nodes.size - visited} node${nodes.size - visited === 1 ? "" : "s"}; flows need a DAG`,
                        undefined,
                    ),
                );
            }
        }
    }

    // Treemap / sunburst hierarchy: ids from keyField, parents from
    // parentField. Orphans hang at the root with a warning; cycles are an
    // error; a parent row's own size is ignored (its value is the sum of its
    // leaves) with a warning. Both marks share the same input contract.
    let treemapSubtree: Map<number, number> | null = null;
    if (spec.mark === "treemap" || spec.mark === "sunburst") {
        const markLabel = spec.mark;
        if (!spec.keyField) {
            diagnostics.push(
                diag("error", `davinci.chart.${markLabel}-needs-key`, `${markLabel} needs keyField naming the id field`, "keyField"),
            );
        }
        if (!spec.parentField) {
            diagnostics.push(
                diag(
                    "error",
                    `davinci.chart.${markLabel}-needs-parent`,
                    `${markLabel} needs parentField naming the parent id field`,
                    "parentField",
                ),
            );
        }
        const sizeEnc = spec.encoding.find((e) => e.channel === "size");
        const sizeCol = sizeEnc ? column(data, sizeEnc.field) : undefined;
        const parentCol = spec.parentField ? column(data, spec.parentField) : undefined;
        if (spec.parentField && !parentCol && data.columns.length > 0) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.unknown-field",
                    `parentField "${spec.parentField}" is not in the data`,
                    spec.parentField,
                ),
            );
        }
        if (keyCol && parentCol && sizeCol) {
            const idOf = (r: number): string | null => {
                const v = keyCol.values[r];
                if (v === null || v === undefined) return null;
                if (typeof v === "number" && !Number.isFinite(v)) return null;
                return String(v);
            };
            const rowOfId = new Map<string, number>();
            for (let r = 0; r < data.rowCount; r++) {
                const id = idOf(r);
                if (id !== null && !rowOfId.has(id)) rowOfId.set(id, r);
            }
            // Drill-down root: an id the data does not contain would silently
            // fall back to the document root, so say so.
            if (spec.mark === "treemap" && spec.treemapRoot !== undefined && !rowOfId.has(spec.treemapRoot)) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.treemap-unknown-root",
                        `treemapRoot "${spec.treemapRoot}" is not a row id; the chart stays at the document root`,
                        "treemapRoot",
                    ),
                );
            }
            const parentOf = new Map<number, number | null>();
            let orphans = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const pv = parentCol.values[r];
                let parent: number | null = null;
                if (pv !== null && pv !== undefined && !(typeof pv === "number" && !Number.isFinite(pv))) {
                    const pr = rowOfId.get(String(pv));
                    if (pr === undefined || pr === r) {
                        if (pr === undefined) orphans++;
                    } else {
                        parent = pr;
                    }
                }
                parentOf.set(r, parent);
            }
            if (orphans > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        `davinci.chart.${markLabel}-orphan`,
                        `parentField "${spec.parentField}" names an unknown parent for ${orphans} row${orphans === 1 ? "" : "s"}; they hang at the root`,
                        spec.parentField,
                    ),
                );
            }
            // Cycle check: walk each row's ancestor chain once.
            let cyclic = false;
            for (let r = 0; r < data.rowCount && !cyclic; r++) {
                const seen = new Set<number>([r]);
                let p = parentOf.get(r) ?? null;
                while (p !== null) {
                    if (seen.has(p)) {
                        cyclic = true;
                        break;
                    }
                    seen.add(p);
                    p = parentOf.get(p) ?? null;
                }
            }
            if (cyclic) {
                diagnostics.push(
                    diag("error", `davinci.chart.${markLabel}-cycle`, `${markLabel} hierarchy contains a cycle`, spec.parentField),
                );
            }
            const childrenOf = new Map<number, number[]>();
            for (const [r, p] of parentOf) {
                if (p === null) continue;
                const list = childrenOf.get(p);
                if (list) list.push(r);
                else childrenOf.set(p, [r]);
            }
            let parentValues = 0;
            const memo = new Map<number, number>();
            const inStack = new Set<number>();
            const sum = (r: number): number => {
                const hit = memo.get(r);
                if (hit !== undefined) return hit;
                if (inStack.has(r)) return 0;
                inStack.add(r);
                const children = childrenOf.get(r) ?? [];
                const own = sizeCol.values[r];
                const ownValue = typeof own === "number" && Number.isFinite(own) && own > 0 ? own : 0;
                let total = ownValue;
                if (children.length > 0) {
                    if (ownValue > 0) parentValues++;
                    total = 0;
                    for (const c of children) total += sum(c);
                }
                inStack.delete(r);
                memo.set(r, total);
                return total;
            };
            for (let r = 0; r < data.rowCount; r++) sum(r);
            if (parentValues > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        `davinci.chart.${markLabel}-parent-value`,
                        `${parentValues} parent row${parentValues === 1 ? "" : "s"} carry a size value; a parent's size is the sum of its leaves and the own value is ignored`,
                        sizeEnc?.field,
                    ),
                );
            }
            treemapSubtree = memo;
        }
    }

    // Waterfall offsets: each delta floats on the cumulative sum of the deltas
    // before it (row order), so the y domain spans every prefix sum.
    if (spec.mark === "waterfall") {
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (yCol) {
            stackOffsets = new Map();
            let cum = 0;
            let lo = 0;
            let hi = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const v = yCol.values[r];
                if (typeof v !== "number" || !Number.isFinite(v)) continue;
                stackOffsets.set(r, cum);
                cum += v;
                if (cum < lo) lo = cum;
                if (cum > hi) hi = cum;
                const base = cum - v;
                if (base < lo) lo = base;
                if (base > hi) hi = base;
            }
            stackExtent = [lo, hi];
        }
    }

    // Histogram bins materialize into a stat snapshot; marks index its rows.
    let stat: DataSnapshot | null = null;
    let histogramBins: { x0: number; x1: number; count: number }[] = [];
    if (spec.mark === "histogram") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        if (xCol) {
            const res = binValues(xCol.values);
            histogramBins = [...res.bins];
            if (histogramBins.length === 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.histogram-no-numeric",
                        `field "${xEnc?.field}" has no finite numeric values to bin`,
                        xEnc?.field,
                    ),
                );
            } else {
                stat = fromRows(histogramBins.map((b) => ({ x0: b.x0, x1: b.x1, count: b.count })));
            }
        }
    }

    // Boxplot five-number summaries (+ outliers) materialize per category.
    interface BoxStatRow {
        cat: string;
        kind: "box" | "outlier";
        j: number;
    }
    let boxStatRows: BoxStatRow[] = [];
    if (spec.mark === "boxplot") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            const byCat = new Map<string, number[]>();
            const order: string[] = [];
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                const yv = yCol.values[r];
                if (xv === null || xv === undefined) continue;
                if (typeof yv !== "number" || !Number.isFinite(yv)) continue;
                const cat = String(xv);
                const bucket = byCat.get(cat);
                if (bucket) bucket.push(yv);
                else {
                    byCat.set(cat, [yv]);
                    order.push(cat);
                }
            }
            const rows: Record<string, unknown>[] = [];
            for (const cat of order) {
                const bs = boxStats(byCat.get(cat)!);
                if (!bs) continue;
                rows.push({ category: cat, kind: "box", low: bs.low, q1: bs.q1, median: bs.median, q3: bs.q3, high: bs.high, n: bs.n, value: null });
                boxStatRows.push({ cat, kind: "box", j: 0 });
                bs.outliers.forEach((v, j) => {
                    rows.push({ category: cat, kind: "outlier", low: null, q1: null, median: null, q3: null, high: null, n: null, value: v });
                    boxStatRows.push({ cat, kind: "outlier", j });
                });
            }
            if (rows.length > 0) stat = fromRows(rows);
        }
    }

    // Ridgeline densities: one shared x grid, per-group Gaussian KDE,
    // normalized so each ridge peaks at 1 (ridges compare shape, not mass).
    let ridgelineGroups: string[] = [];
    let ridgelineGridSize = 0;
    if (spec.mark === "ridgeline") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            const byGroup = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const gv = yCol.values[r];
                const xv = xCol.values[r];
                if (gv === null || gv === undefined) continue;
                if (typeof xv !== "number" || !Number.isFinite(xv)) continue;
                const g = String(gv);
                const bucket = byGroup.get(g);
                if (bucket) bucket.push(xv);
                else byGroup.set(g, [xv]);
            }
            ridgelineGroups = [...byGroup.keys()];
            const all = xCol.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            if (ridgelineGroups.length > 0 && all.length > 0) {
                let lo = Math.min(...all);
                let hi = Math.max(...all);
                if (lo === hi) {
                    lo -= 0.5;
                    hi += 0.5;
                }
                const G = 128;
                const grid: number[] = [];
                for (let i = 0; i < G; i++) grid.push(lo + ((hi - lo) * i) / (G - 1));
                const rows: Record<string, unknown>[] = [];
                for (const g of ridgelineGroups) {
                    const xs = byGroup.get(g)!;
                    const bw = silvermanBandwidth(xs);
                    const dens = kde(xs, grid, bw);
                    const peak = Math.max(...dens);
                    for (let i = 0; i < G; i++) {
                        rows.push({ group: g, gx: grid[i], gy: peak > 0 ? dens[i] / peak : 0, n: xs.length });
                    }
                }
                stat = fromRows(rows);
                ridgelineGridSize = G;
            }
        }
    }

    // Bump ranks: competition rank per x slot, rank 1 = largest value. The raw
    // y stays the tooltip value; the rank drives geometry.
    let bumpRanks: Map<number, number> | null = null;
    let bumpMaxRank = 0;
    if (spec.mark === "bump") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (!legendCol) {
            diagnostics.push(
                diag(
                    "info",
                    "davinci.chart.bump-needs-series",
                    `bump ranks series against each other; without a color / series channel every rank is 1`,
                    undefined,
                ),
            );
        }
        if (xCol && yCol) {
            const byX = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                if (xv === null || xv === undefined) continue;
                const key = String(xv);
                const bucket = byX.get(key);
                if (bucket) bucket.push(r);
                else byX.set(key, [r]);
            }
            bumpRanks = new Map();
            for (const rows of byX.values()) {
                const values = rows.map((r) => {
                    const v = yCol.values[r];
                    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
                });
                const ranks = rankDescending(values);
                for (const [idx, rank] of ranks) {
                    bumpRanks.set(rows[idx], rank);
                    if (rank > bumpMaxRank) bumpMaxRank = rank;
                }
            }
        }
    }

    // Streamgraph wiggle offsets: each x slot's stacked ribbons balance around
    // zero at −Σ/2, so the silhouette wiggles instead of sitting on a baseline.
    // Without a series channel there are no ribbons to balance — refuse loudly.
    if (spec.mark === "streamgraph" && !legendCol) {
        diagnostics.push(
            diag(
                "error",
                "davinci.chart.streamgraph-needs-series",
                `streamgraph needs a color / series / group channel: a single stream has no wiggle to balance`,
                undefined,
            ),
        );
    }
    if (spec.mark === "streamgraph") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            stackOffsets = new Map();
            const byX = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                if (xv === null || xv === undefined) continue;
                const key = String(xv);
                const bucket = byX.get(key);
                if (bucket) bucket.push(r);
                else byX.set(key, [r]);
            }
            let lo = 0;
            let hi = 0;
            for (const rows of byX.values()) {
                let total = 0;
                for (const r of rows) {
                    const v = yCol.values[r];
                    if (typeof v === "number" && Number.isFinite(v)) total += v;
                }
                let cum = -total / 2;
                if (cum < lo) lo = cum;
                for (const category of seriesCategories) {
                    for (const r of rows) {
                        const cell = legendCol ? legendCol.values[r] : null;
                        if (legendCol && (cell === null || cell === undefined || String(cell) !== category)) continue;
                        const v = yCol.values[r];
                        if (typeof v !== "number" || !Number.isFinite(v)) continue;
                        stackOffsets.set(r, cum);
                        cum += v;
                    }
                }
                if (cum > hi) hi = cum;
            }
            stackExtent = [lo, hi];
        }
    }

    // Percent stack: same slot accumulation as `stack`, normalized so every x
    // slot totals exactly 100. Negative shares are dropped with a warning.
    let percentShares: Map<number, number> | null = null;
    if (layout === "percent" && stackable) {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol && legendCol) {
            stackOffsets = new Map();
            percentShares = new Map();
            let dropped = 0;
            const byX = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                if (xv === null || xv === undefined) continue;
                const key = String(xv);
                const bucket = byX.get(key);
                if (bucket) bucket.push(r);
                else byX.set(key, [r]);
            }
            for (const rows of byX.values()) {
                let total = 0;
                for (const r of rows) {
                    const v = yCol.values[r];
                    if (typeof v !== "number" || !Number.isFinite(v)) continue;
                    if (v < 0) {
                        dropped++;
                        continue;
                    }
                    total += v;
                }
                if (!(total > 0)) continue;
                let cum = 0;
                for (const category of seriesCategories) {
                    for (const r of rows) {
                        const cell = legendCol.values[r];
                        if (cell === null || cell === undefined || String(cell) !== category) continue;
                        const v = yCol.values[r];
                        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
                        const share = (v / total) * 100;
                        stackOffsets.set(r, cum);
                        percentShares.set(r, share);
                        cum += share;
                    }
                }
            }
            if (dropped > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.percent-negative-share",
                        `${dropped} negative row${dropped === 1 ? "" : "s"} dropped: percent stacks need non-negative shares`,
                        yEnc?.field,
                    ),
                );
            }
            stackExtent = [0, 100];
        }
    }

    // Violin densities per category on the shared value domain, plus the
    // five-number summary embedded in the mark channels.
    interface ViolinCat {
        cat: string;
        firstStatRow: number;
        q1: number;
        median: number;
        q3: number;
        low: number;
        high: number;
        n: number;
    }
    let violinCats: ViolinCat[] = [];
    if (spec.mark === "violin") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            const byCat = new Map<string, number[]>();
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                const yv = yCol.values[r];
                if (xv === null || xv === undefined) continue;
                if (typeof yv !== "number" || !Number.isFinite(yv)) continue;
                const cat = String(xv);
                const bucket = byCat.get(cat);
                if (bucket) bucket.push(yv);
                else byCat.set(cat, [yv]);
            }
            const all = yCol.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            if (byCat.size > 0 && all.length > 0) {
                let lo = Math.min(...all);
                let hi = Math.max(...all);
                if (lo === hi) {
                    lo -= 0.5;
                    hi += 0.5;
                }
                const G = 64;
                const grid: number[] = [];
                for (let i = 0; i < G; i++) grid.push(lo + ((hi - lo) * i) / (G - 1));
                const rows: Record<string, unknown>[] = [];
                violinCats = [];
                for (const [cat, xs] of byCat) {
                    const bs = boxStats(xs);
                    if (!bs) continue;
                    const firstStatRow = rows.length;
                    const bw = silvermanBandwidth(xs);
                    const dens = kde(xs, grid, bw);
                    const peak = Math.max(...dens);
                    for (let i = 0; i < G; i++) {
                        rows.push({ category: cat, gy: grid[i], density: peak > 0 ? dens[i] / peak : 0 });
                    }
                    violinCats.push({ cat, firstStatRow, q1: bs.q1, median: bs.median, q3: bs.q3, low: bs.low, high: bs.high, n: bs.n });
                }
                stat = fromRows(rows);
            }
        }
    }

    // Calendar cells: strict YYYY-MM-DD dates mapped to ISO week columns and
    // weekday rows. Invalid dates never reach the grid.
    if (spec.mark === "calendar") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const cEnc = spec.encoding.find((e) => e.channel === "color");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const cCol = cEnc ? column(data, cEnc.field) : undefined;
        if (xCol && cCol) {
            const parsed: { date: string; days: number; value: number }[] = [];
            let invalid = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const raw = xCol.values[r];
                const v = cCol.values[r];
                if (raw === null || raw === undefined) continue;
                if (typeof v !== "number" || !Number.isFinite(v)) continue;
                const days = parseCalendarDate(raw);
                if (days === null) {
                    invalid++;
                    continue;
                }
                parsed.push({ date: String(raw), days, value: v });
            }
            if (invalid > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.calendar-invalid-date",
                        `${invalid} row${invalid === 1 ? "" : "s"} are not strict YYYY-MM-DD dates and never reach the calendar grid`,
                        xEnc?.field,
                    ),
                );
            }
            if (parsed.length > 0) {
                const minDays = Math.min(...parsed.map((p) => p.days));
                const firstMonday = minDays - ((weekdayOfDays(minDays) + 6) % 7);
                const rows: Record<string, unknown>[] = parsed.map((p) => {
                    const weekday = (weekdayOfDays(p.days) + 6) % 7;
                    const monday = p.days - weekday;
                    return { date: p.date, week: Math.floor((monday - firstMonday) / 7), weekday, value: p.value };
                });
                stat = fromRows(rows);
            }
        }
    }

    // Mosaic shares: every x slot gets a width share of the grand total and
    // segment shares inside its slot — all ratios resolved before the scene.
    let mosaicOffsets: Map<string, number> | null = null;
    let mosaicWidths: Map<string, number> | null = null;
    let mosaicShares: Map<number, number> | null = null;
    if (spec.mark === "mosaic") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol && legendCol) {
            const byX = new Map<string, number[]>();
            const order: string[] = [];
            for (let r = 0; r < data.rowCount; r++) {
                const xv = xCol.values[r];
                if (xv === null || xv === undefined) continue;
                const key = String(xv);
                const bucket = byX.get(key);
                if (bucket) bucket.push(r);
                else {
                    byX.set(key, [r]);
                    order.push(key);
                }
            }
            const totals = new Map<string, number>();
            let grand = 0;
            let dropped = 0;
            for (const [key, rows] of byX) {
                let total = 0;
                for (const r of rows) {
                    const v = yCol.values[r];
                    if (typeof v !== "number" || !Number.isFinite(v)) continue;
                    if (v < 0) {
                        dropped++;
                        continue;
                    }
                    total += v;
                }
                totals.set(key, total);
                grand += total;
            }
            if (dropped > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.mosaic-negative-share",
                        `${dropped} negative row${dropped === 1 ? "" : "s"} dropped: mosaic segments need non-negative shares`,
                        yEnc?.field,
                    ),
                );
            }
            if (grand > 0) {
                mosaicOffsets = new Map();
                mosaicWidths = new Map();
                mosaicShares = new Map();
                stackOffsets = new Map();
                let cumX = 0;
                for (const key of order) {
                    const total = totals.get(key)!;
                    mosaicOffsets.set(key, cumX / grand);
                    mosaicWidths.set(key, total / grand);
                    cumX += total;
                    let cum = 0;
                    for (const category of seriesCategories) {
                        for (const r of byX.get(key)!) {
                            const cell = legendCol.values[r];
                            if (cell === null || cell === undefined || String(cell) !== category) continue;
                            const v = yCol.values[r];
                            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
                            if (!(total > 0)) continue;
                            stackOffsets.set(r, cum / total);
                            mosaicShares.set(r, v / total);
                            cum += v;
                        }
                    }
                }
            }
        }
    }

    // Gantt spans: start / end parse as numbers or strict YYYY-MM-DD dates;
    // rows without both ends parsed never reach the frame.
    let ganttSpans: Map<number, [number, number]> | null = null;
    if (spec.mark === "gantt") {
        const sEnc = spec.encoding.find((e) => e.channel === "start");
        const eEnc = spec.encoding.find((e) => e.channel === "end");
        const sCol = sEnc ? column(data, sEnc.field) : undefined;
        const eCol = eEnc ? column(data, eEnc.field) : undefined;
        if (sCol && eCol) {
            ganttSpans = new Map();
            let invalid = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const s = parseGanttValue(sCol.values[r]);
                const e = parseGanttValue(eCol.values[r]);
                if (s === null || e === null) {
                    invalid++;
                    continue;
                }
                ganttSpans.set(r, [Math.min(s, e), Math.max(s, e)]);
            }
            if (invalid > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.gantt-invalid-span",
                        `${invalid} row${invalid === 1 ? "" : "s"} lack a parseable start / end (number or YYYY-MM-DD) and never reach the frame`,
                        sEnc?.field,
                    ),
                );
            }
        }
    }

    // Tree hierarchy: same id / parent contract as treemap, no size channel —
    // layout only needs structure. Orphans and cycles are diagnosed alike.
    if (spec.mark === "tree") {
        if (!spec.keyField) {
            diagnostics.push(diag("error", "davinci.chart.tree-needs-key", `tree needs keyField naming the id field`, "keyField"));
        }
        if (!spec.parentField) {
            diagnostics.push(
                diag("error", "davinci.chart.tree-needs-parent", `tree needs parentField naming the parent id field`, "parentField"),
            );
        }
        const parentCol = spec.parentField ? column(data, spec.parentField) : undefined;
        if (spec.parentField && !parentCol && data.columns.length > 0) {
            diagnostics.push(
                diag("error", "davinci.chart.unknown-field", `parentField "${spec.parentField}" is not in the data`, spec.parentField),
            );
        }
        if (keyCol && parentCol) {
            const rowOfId = new Map<string, number>();
            for (let r = 0; r < data.rowCount; r++) {
                const v = keyCol.values[r];
                if (v === null || v === undefined) continue;
                if (typeof v === "number" && !Number.isFinite(v)) continue;
                const id = String(v);
                if (!rowOfId.has(id)) rowOfId.set(id, r);
            }
            const parentOf = new Map<number, number | null>();
            let orphans = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const pv = parentCol.values[r];
                let parent: number | null = null;
                if (pv !== null && pv !== undefined && !(typeof pv === "number" && !Number.isFinite(pv))) {
                    const pr = rowOfId.get(String(pv));
                    if (pr === undefined || pr === r) {
                        if (pr === undefined) orphans++;
                    } else {
                        parent = pr;
                    }
                }
                parentOf.set(r, parent);
            }
            if (orphans > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.tree-orphan",
                        `parentField "${spec.parentField}" names an unknown parent for ${orphans} row${orphans === 1 ? "" : "s"}; they hang at the root`,
                        spec.parentField,
                    ),
                );
            }
            let cyclic = false;
            for (let r = 0; r < data.rowCount && !cyclic; r++) {
                const seen = new Set<number>([r]);
                let p = parentOf.get(r) ?? null;
                while (p !== null) {
                    if (seen.has(p)) {
                        cyclic = true;
                        break;
                    }
                    seen.add(p);
                    p = parentOf.get(p) ?? null;
                }
            }
            if (cyclic) {
                diagnostics.push(diag("error", "davinci.chart.tree-cycle", `tree hierarchy contains a cycle`, spec.parentField));
            }
        }
    }

    // Force layout: deterministic seed from the edge fingerprint, fixed 300
    // iterations (never a convergence claim), positions materialized into
    // node channels. Oversized graphs are degree-sampled with a warning.
    interface ForceNodeInfo {
        key: string;
        rowIndex: number;
        degree: number;
        x: number;
        y: number;
    }
    let forceNodes: ForceNodeInfo[] = [];
    if (spec.mark === "force") {
        const sEnc = spec.encoding.find((e) => e.channel === "source");
        const tEnc = spec.encoding.find((e) => e.channel === "target");
        const sCol = sEnc ? column(data, sEnc.field) : undefined;
        const tCol = tEnc ? column(data, tEnc.field) : undefined;
        if (sCol && tCol) {
            // Dedupe edges (merge weights), refuse self-loops loudly.
            const edgeMap = new Map<string, { s: string; t: string; w: number }>();
            let selfLoops = 0;
            let dupes = 0;
            const nodeRow = new Map<string, number>();
            for (let r = 0; r < data.rowCount; r++) {
                const s = sCol.values[r];
                const t = tCol.values[r];
                if (s === null || s === undefined || t === null || t === undefined) continue;
                const source = String(s);
                const target = String(t);
                if (source === target) {
                    selfLoops++;
                    continue;
                }
                const id = source < target ? `${source}→${target}` : `${target}→${source}`;
                const hit = edgeMap.get(id);
                if (hit) {
                    hit.w += 1;
                    dupes++;
                } else {
                    edgeMap.set(id, { s: source, t: target, w: 1 });
                }
                if (!nodeRow.has(source)) nodeRow.set(source, r);
                if (!nodeRow.has(target)) nodeRow.set(target, r);
            }
            if (selfLoops > 0) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.force-self-loop",
                        `${selfLoops} self-loop${selfLoops === 1 ? "" : "s"} refused: a force graph edge needs two distinct nodes`,
                        sEnc?.field,
                    ),
                );
            }
            if (dupes > 0) {
                diagnostics.push(
                    diag(
                        "info",
                        "davinci.chart.force-duplicate-edge",
                        `${dupes} duplicate edge${dupes === 1 ? "" : "s"} merged into their twin's weight`,
                        undefined,
                    ),
                );
            }
            // Degree sampling above the cap — deterministic order.
            const degree = new Map<string, number>();
            for (const e of edgeMap.values()) {
                degree.set(e.s, (degree.get(e.s) ?? 0) + 1);
                degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
            }
            const FORCE_MAX_NODES = 400;
            let kept = [...nodeRow.keys()];
            if (kept.length > FORCE_MAX_NODES) {
                const order = new Map(kept.map((k, i) => [k, i]));
                kept.sort((a, b) => (degree.get(b)! -degree.get(a)!) || (order.get(a)! -order.get(b)!));
                const dropped = kept.length - FORCE_MAX_NODES;
                kept = kept.slice(0, FORCE_MAX_NODES);
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.force-sampled",
                        `force layout sampled ${FORCE_MAX_NODES} of ${kept.length + dropped} nodes by degree; ${dropped} dropped`,
                        undefined,
                    ),
                );
            }
            const keptSet = new Set(kept);
            const links = [...edgeMap.values()].filter((e) => keptSet.has(e.s) && keptSet.has(e.t));
            // Deterministic seed: FNV-1a over the canonical edge list.
            const fingerprint = links
                .map((e) => `${e.s}>${e.t}:${e.w}`)
                .sort()
                .join("|");
            let rngState = 0x811c9dc5;
            for (let i = 0; i < fingerprint.length; i++) {
                rngState ^= fingerprint.charCodeAt(i);
                rngState = Math.imul(rngState, 0x01000193);
            }
            const rand = (): number => {
                rngState |= 0;
                rngState = (rngState + 0x6d2b79f5) | 0;
                let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
            const n = kept.length;
            const xs = new Float64Array(n);
            const ys = new Float64Array(n);
            const idxOf = new Map(kept.map((k, i) => [k, i]));
            // Golden-angle spiral init with a tiny seeded jitter.
            for (let i = 0; i < n; i++) {
                const r = Math.sqrt(i + 0.5);
                const theta = i * 2.399963229728653 + rand() * 0.05;
                xs[i] = r * Math.cos(theta);
                ys[i] = r * Math.sin(theta);
            }
            const k = Math.sqrt(1 / Math.max(1, n));
            const dx = new Float64Array(n);
            const dy = new Float64Array(n);
            for (let iter = 0; iter < 300; iter++) {
                dx.fill(0);
                dy.fill(0);
                for (let i = 0; i < n; i++) {
                    for (let j = i + 1; j < n; j++) {
                        const ddx = xs[i] - xs[j];
                        const ddy = ys[i] - ys[j];
                        const dist2 = Math.max(0.01, ddx * ddx + ddy * ddy);
                        const f = ((k * k) / dist2) * 0.5;
                        const fx = (ddx / Math.sqrt(dist2)) * f;
                        const fy = (ddy / Math.sqrt(dist2)) * f;
                        dx[i] += fx;
                        dy[i] += fy;
                        dx[j] -= fx;
                        dy[j] -= fy;
                    }
                }
                for (const e of links) {
                    const a = idxOf.get(e.s)!;
                    const b = idxOf.get(e.t)!;
                    const ddx = xs[b] - xs[a];
                    const ddy = ys[b] - ys[a];
                    const dist = Math.max(0.01, Math.sqrt(ddx * ddx + ddy * ddy));
                    const f = ((dist * dist) / k) * 0.02 * Math.min(4, e.w);
                    const fx = (ddx / dist) * f;
                    const fy = (ddy / dist) * f;
                    dx[a] += fx;
                    dy[a] += fy;
                    dx[b] -= fx;
                    dy[b] -= fy;
                }
                const cool = 1 - iter / 300;
                for (let i = 0; i < n; i++) {
                    xs[i] += dx[i] * cool;
                    ys[i] += dy[i] * cool;
                    // Gentle centering keeps the cloud from drifting away.
                    xs[i] *= 1 - 0.02 * cool;
                    ys[i] *= 1 - 0.02 * cool;
                }
            }
            // Normalize the bounding box into [0.05, 0.95]².
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < n; i++) {
                if (xs[i] < minX) minX = xs[i];
                if (xs[i] > maxX) maxX = xs[i];
                if (ys[i] < minY) minY = ys[i];
                if (ys[i] > maxY) maxY = ys[i];
            }
            const spanX = maxX - minX || 1;
            const spanY = maxY - minY || 1;
            forceNodes = kept.map((key, i) => ({
                key,
                rowIndex: nodeRow.get(key)!,
                degree: degree.get(key) ?? 0,
                x: 0.05 + (0.9 * (xs[i] - minX)) / spanX,
                y: 0.05 + (0.9 * (ys[i] - minY)) / spanY,
            }));
            // Links materialize too — the scene never re-reads the edge list.
            stat = fromRows(links.map((e) => ({ source: e.s, target: e.t, weight: e.w })));
        }
    }

    // Parallel coordinates: one independent linear domain per dimension,
    // materialized into the stat snapshot in authoring order.
    let parallelDims: { dim: string; lo: number; hi: number }[] = [];
    if (spec.mark === "parallel") {
        const dims = spec.dimensions ?? [];
        if (dims.length < 2) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.parallel-needs-dimensions",
                    `parallel coordinates need at least two entries in dimensions, got ${dims.length}`,
                    "dimensions",
                ),
            );
        }
        parallelDims = [];
        for (const dim of dims) {
            const col = column(data, dim);
            if (!col) {
                if (data.columns.length > 0) {
                    diagnostics.push(
                        diag("error", "davinci.chart.unknown-field", `dimension "${dim}" is not in the data`, dim),
                    );
                }
                continue;
            }
            const nums = col.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            if (nums.length === 0) {
                diagnostics.push(
                    diag("warning", "davinci.chart.parallel-empty-dimension", `dimension "${dim}" has no finite numeric values`, dim),
                );
                continue;
            }
            parallelDims.push({ dim, lo: Math.min(...nums), hi: Math.max(...nums) });
        }
        if (parallelDims.length > 0) {
            stat = fromRows(parallelDims.map((d) => ({ dim: d.dim, lo: d.lo, hi: d.hi })));
        }
        // Rows missing any dimension value never reach the frame.
    }

    // Hexbin: hexagonal aggregation grid over the scatter extent.
    interface HexCell {
        cx: number;
        cy: number;
        count: number;
    }
    let hexCells: HexCell[] = [];
    let hexRadius = 1;
    if (spec.mark === "hexbin") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            const pts: [number, number][] = [];
            for (let r = 0; r < data.rowCount; r++) {
                const x = xCol.values[r];
                const y = yCol.values[r];
                if (typeof x !== "number" || !Number.isFinite(x)) continue;
                if (typeof y !== "number" || !Number.isFinite(y)) continue;
                pts.push([x, y]);
            }
            if (pts.length > 0) {
                const xs = pts.map((p) => p[0]);
                const ys = pts.map((p) => p[1]);
                let minX = Math.min(...xs);
                let maxX = Math.max(...xs);
                let minY = Math.min(...ys);
                let maxY = Math.max(...ys);
                if (minX === maxX) {
                    minX -= 0.5;
                    maxX += 0.5;
                }
                if (minY === maxY) {
                    minY -= 0.5;
                    maxY += 0.5;
                }
                hexRadius = (maxX - minX) / 18;
                const dx = hexRadius * 1.5;
                const dy = hexRadius * Math.sqrt(3);
                const cells = new Map<string, HexCell>();
                for (const [x, y] of pts) {
                    // Axial rounding for pointy-top hexagons.
                    const q = (x - minX) / dx;
                    const row = Math.round((y - minY) / dy);
                    const col = Math.round(q - (row % 2 === 0 ? 0 : 0.5));
                    const cx = minX + (col + (row % 2 === 0 ? 0 : 0.5)) * dx;
                    const cy = minY + row * dy;
                    const id = `${col}:${row}`;
                    const cell = cells.get(id);
                    if (cell) cell.count++;
                    else cells.set(id, { cx, cy, count: 1 });
                }
                hexCells = [...cells.values()];
                stat = fromRows(hexCells.map((c) => ({ cx: c.cx, cy: c.cy, count: c.count, radius: hexRadius })));
            }
        }
    }

    // Contour: 2D Gaussian KDE over a shared grid, marching squares at nice
    // levels, rings materialized as point rows grouped by (level, ring).
    interface ContourRing {
        level: number;
        firstStatRow: number;
    }
    let contourRings: ContourRing[] = [];
    if (spec.mark === "contour") {
        const xEnc = spec.encoding.find((e) => e.channel === "x");
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const xCol = xEnc ? column(data, xEnc.field) : undefined;
        const yCol = yEnc ? column(data, yEnc.field) : undefined;
        if (xCol && yCol) {
            const pts: [number, number][] = [];
            for (let r = 0; r < data.rowCount; r++) {
                const x = xCol.values[r];
                const y = yCol.values[r];
                if (typeof x !== "number" || !Number.isFinite(x)) continue;
                if (typeof y !== "number" || !Number.isFinite(y)) continue;
                pts.push([x, y]);
            }
            if (pts.length < 3) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.contour-few-points",
                        `contour needs at least three usable points, got ${pts.length}`,
                        xEnc?.field,
                    ),
                );
            } else {
                const xs = pts.map((p) => p[0]);
                const ys = pts.map((p) => p[1]);
                let minX = Math.min(...xs);
                let maxX = Math.max(...xs);
                let minY = Math.min(...ys);
                let maxY = Math.max(...ys);
                const padX = (maxX - minX || 1) * 0.1;
                const padY = (maxY - minY || 1) * 0.1;
                minX -= padX;
                maxX += padX;
                minY -= padY;
                maxY += padY;
                const G = 48;
                const gx: number[] = [];
                const gy: number[] = [];
                for (let i = 0; i < G; i++) {
                    gx.push(minX + ((maxX - minX) * i) / (G - 1));
                    gy.push(minY + ((maxY - minY) * i) / (G - 1));
                }
                const bwx = silvermanBandwidth(xs);
                const bwy = silvermanBandwidth(ys);
                const field = new Float64Array(G * G);
                let peak = 0;
                for (let j = 0; j < G; j++) {
                    for (let i = 0; i < G; i++) {
                        let sum = 0;
                        for (const [x, y] of pts) {
                            const ux = (gx[i] - x) / bwx;
                            const uy = (gy[j] - y) / bwy;
                            if (ux > 4 || ux < -4 || uy > 4 || uy < -4) continue;
                            sum += Math.exp(-0.5 * (ux * ux + uy * uy));
                        }
                        field[j * G + i] = sum;
                        if (sum > peak) peak = sum;
                    }
                }
                if (peak > 0) {
                    const levelValues = niceLinearTicks([0, peak]).values.filter((v) => v > 0).slice(0, 6);
                    const statRows: Record<string, unknown>[] = [];
                    contourRings = [];
                    for (const level of levelValues) {
                        const rings = marchingSquares(field, G, gx, gy, level);
                        for (const ring of rings) {
                            if (ring.length < 3) continue;
                            contourRings.push({ level, firstStatRow: statRows.length });
                            for (const p of ring) statRows.push({ level, px: p.x, py: p.y });
                        }
                    }
                    if (statRows.length > 0) stat = fromRows(statRows);
                }
            }
        }
    }

    // Chord: aggregate the edge list into a group matrix, order groups by
    // total desc, and pre-assign every link its source / target arc spans.
    interface ChordLinkSpan {
        rowIndex: number;
        key: string;
        s: string;
        t: string;
        v: number;
        sa0: number;
        sa1: number;
        ta0: number;
        ta1: number;
    }
    let chordLinks: ChordLinkSpan[] = [];
    let chordGroups: { name: string; a0: number; a1: number; total: number }[] = [];
    if (spec.mark === "chord") {
        const sEnc = spec.encoding.find((e) => e.channel === "source");
        const tEnc = spec.encoding.find((e) => e.channel === "target");
        const vEnc = spec.encoding.find((e) => e.channel === "value");
        const sCol = sEnc ? column(data, sEnc.field) : undefined;
        const tCol = tEnc ? column(data, tEnc.field) : undefined;
        const vCol = vEnc ? column(data, vEnc.field) : undefined;
        if (sCol && tCol && vCol) {
            const rawLinks: ChordLinkSpan[] = [];
            let selfLinks = 0;
            for (let r = 0; r < data.rowCount; r++) {
                const s = sCol.values[r];
                const t = tCol.values[r];
                const v = vCol.values[r];
                if (s === null || s === undefined || t === null || t === undefined) continue;
                if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
                if (String(s) === String(t)) {
                    selfLinks++;
                    continue;
                }
                rawLinks.push({ rowIndex: r, key: String(r), s: String(s), t: String(t), v, sa0: 0, sa1: 0, ta0: 0, ta1: 0 });
            }
            if (selfLinks > 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.chord-self-link",
                        `${selfLinks} self-link${selfLinks === 1 ? "" : "s"} dropped: chord ribbons need two distinct groups`,
                        sEnc?.field,
                    ),
                );
            }
            if (rawLinks.length > 0) {
                const totals = new Map<string, number>();
                const order: string[] = [];
                for (const l of rawLinks) {
                    if (!totals.has(l.s)) order.push(l.s);
                    if (!totals.has(l.t)) order.push(l.t);
                    totals.set(l.s, (totals.get(l.s) ?? 0) + l.v);
                    totals.set(l.t, (totals.get(l.t) ?? 0) + l.v);
                }
                const groups = [...totals.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
                const grand = groups.reduce((a, [, t]) => a + t, 0);
                const GAP = 0.02;
                const spanTotal = Math.PI * 2 - GAP * groups.length;
                let acc = -Math.PI / 2;
                const groupSpan = new Map<string, { a0: number; a1: number }>();
                chordGroups = [];
                for (const [name, total] of groups) {
                    const span = (spanTotal * total) / grand;
                    groupSpan.set(name, { a0: acc, a1: acc + span });
                    chordGroups.push({ name, a0: acc, a1: acc + span, total });
                    acc += span + GAP;
                }
                // Within each group, links take sub-spans proportional to value,
                // descending — source side and target side independently.
                const sideCursor = new Map<string, number>();
                for (const [name] of groups) sideCursor.set(name + ":out", groupSpan.get(name)!.a0);
                for (const [name] of groups) sideCursor.set(name + ":in", groupSpan.get(name)!.a0);
                const sorted = [...rawLinks].sort((a, b) => b.v - a.v);
                for (const l of sorted) {
                    const sSpan = groupSpan.get(l.s)!;
                    const tSpan = groupSpan.get(l.t)!;
                    const sTotal = totals.get(l.s)!;
                    const tTotal = totals.get(l.t)!;
                    const sLen = ((sSpan.a1 - sSpan.a0) * l.v) / sTotal;
                    const tLen = ((tSpan.a1 - tSpan.a0) * l.v) / tTotal;
                    l.sa0 = sideCursor.get(l.s + ":out")!;
                    l.sa1 = l.sa0 + sLen;
                    sideCursor.set(l.s + ":out", l.sa1);
                    l.ta0 = sideCursor.get(l.t + ":in")!;
                    l.ta1 = l.ta0 + tLen;
                    sideCursor.set(l.t + ":in", l.ta1);
                }
                chordLinks = sorted;
                // Group arcs materialize — the scene never re-derives angles.
                stat = fromRows(chordGroups.map((g) => ({ name: g.name, a0: g.a0, a1: g.a1, total: g.total })));
            }
        }
    }

    // Geo choropleth: match region values to basemap features (exact `name`,
    // then `iso_a3`) and project every ring once. Regions with no feature and
    // maps the host never registered are loud authoring errors.
    let geoMatched: Set<number> | null = null;
    let geoFeatureOf: Map<number, string> | null = null;
    if (spec.mark === "geo") {
        const rEnc = spec.encoding.find((e) => e.channel === "region");
        const cEnc = spec.encoding.find((e) => e.channel === "color");
        const rCol = rEnc ? column(data, rEnc.field) : undefined;
        const cCol = cEnc ? column(data, cEnc.field) : undefined;
        if (!spec.geo) {
            diagnostics.push(
                diag("error", "davinci.chart.geo-needs-map", `geo needs a \`geo: { map, projection }\` spec block`, "geo"),
            );
        } else {
            const map = geoMapById(spec.geo.map);
            if (!map) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.geo-unknown-map",
                        `basemap "${spec.geo.map}" is not registered; the host must registerGeoMap it first`,
                        spec.geo.map,
                    ),
                );
            } else if (rCol && cCol) {
                // Project every feature ring once.
                const project = geoProjector(spec.geo.projection);
                interface ProjectedRing {
                    name: string;
                    poly: number;
                    hole: number;
                    pts: [number, number][];
                }
                const rings: ProjectedRing[] = [];
                let minX = Infinity;
                let maxX = -Infinity;
                let minY = Infinity;
                let maxY = -Infinity;
                const pushRing = (name: string, poly: number, hole: number, ring: ReadonlyArray<ReadonlyArray<number>>): void => {
                    const pts: [number, number][] = ring.map(([lon, lat]) => project(lon, lat));
                    for (const [x, y] of pts) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                    rings.push({ name, poly, hole, pts });
                };
                for (const f of map.features) {
                    const name = f.properties.name;
                    if (f.geometry.type === "Polygon") {
                        f.geometry.coordinates.forEach((ring, ri) => pushRing(name, 0, ri > 0 ? 1 : 0, ring));
                    } else if (f.geometry.type === "MultiPolygon") {
                        f.geometry.coordinates.forEach((poly, pi) => poly.forEach((ring, ri) => pushRing(name, pi, ri > 0 ? 1 : 0, ring)));
                    }
                }
                // Normalize into [0, 1]² preserving aspect.
                const spanX = maxX - minX || 1;
                const spanY = maxY - minY || 1;
                const fit = Math.max(spanX, spanY);
                const statRows: Record<string, unknown>[] = [];
                rings.forEach((ring, ringIndex) => {
                    // Punch holes under the nonzero fill rule: holes get the
                    // opposite winding of their polygon's outer ring.
                    const outer = ring.hole === 1 ? rings.find((r) => r.name === ring.name && r.poly === ring.poly && r.hole === 0) : undefined;
                    let pts = ring.pts;
                    if (outer && signedRingArea(pts) * signedRingArea(outer.pts) > 0) pts = [...pts].reverse();
                    for (const [x, y] of pts) {
                        statRows.push({
                            name: ring.name,
                            ring: ringIndex,
                            hole: ring.hole,
                            px: 0.02 + (0.96 * (x - minX)) / fit,
                            py: 0.02 + (0.96 * (y - minY)) / fit,
                        });
                    }
                });
                if (statRows.length > 0) stat = fromRows(statRows);
                // Match data rows to features by name, then iso_a3, and keep
                // the matched feature name per row (iso matches must still
                // find their fill value at scene time).
                const nameOf = new Map<string, string>();
                for (const f of map.features) {
                    nameOf.set(f.properties.name, f.properties.name);
                    nameOf.set(f.properties.iso_a3, f.properties.name);
                }
                geoMatched = new Set();
                geoFeatureOf = new Map();
                const unmatched = new Set<string>();
                for (let r = 0; r < data.rowCount; r++) {
                    const rv = rCol.values[r];
                    if (rv === null || rv === undefined) continue;
                    const key = String(rv);
                    const feature = nameOf.get(key) ?? nameOf.get(key.toUpperCase());
                    if (feature !== undefined) {
                        geoMatched.add(r);
                        geoFeatureOf.set(r, feature);
                    } else {
                        unmatched.add(key);
                    }
                }
                if (unmatched.size > 0) {
                    diagnostics.push(
                        diag(
                            "warning",
                            "davinci.chart.geo-unmatched-region",
                            `${unmatched.size} region value${unmatched.size === 1 ? "" : "s"} match no basemap feature: ${[...unmatched].slice(0, 5).join(", ")}${unmatched.size > 5 ? ", …" : ""}`,
                            rEnc?.field,
                        ),
                    );
                }
            }
        }
    }

    for (const enc of spec.encoding) {
        const col = column(data, enc.field);
        if (!col) {
            // An empty snapshot has no columns at all — that is "no data", not
            // a missing field, so only a populated snapshot can raise this.
            if (data.columns.length > 0) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.unknown-field",
                        `encoding channel "${enc.channel}" references field "${enc.field}", which is not in the data`,
                        enc.field,
                    ),
                );
            }
            continue;
        }
        // Candlestick OHLC channels share ONE y scale derived after this loop
        // from the union of high/low — per-channel scales would split the frame.
        if (
            spec.mark === "candlestick" &&
            (enc.channel === "open" || enc.channel === "high" || enc.channel === "low" || enc.channel === "close")
        ) {
            continue;
        }
        // Auto-derive scales based on field semantics (simple heuristic).
        if (spec.scales?.has(enc.channel)) {
            const explicit = spec.scales.get(enc.channel)!;
            // A log scale whose domain endpoints are not finite and positive
            // maps no real position. Refuse it outright — the scale is never
            // installed and never silently replaced by an auto-derived one,
            // so the channel stays scale-less (an empty chart) and the
            // diagnostic says why.
            if (explicit.kind === "log" && !isLogDomainUsable(explicit.domain)) {
                diagnostics.push(
                    diag(
                        "error",
                        "davinci.chart.invalid-log-domain",
                        `log scale on channel "${enc.channel}" needs a finite positive domain, got [${String(explicit.domain[0])}, ${String(explicit.domain[1])}]`,
                        enc.channel,
                    ),
                );
                continue;
            }
            scales.set(enc.channel, explicit);
            continue;
        }
        switch (col.semantic) {
            case "quantitative": {
                const numeric = col.values.filter(
                    (v): v is number => typeof v === "number" && Number.isFinite(v),
                );
                if (numeric.length === 0) {
                    scales.set(enc.channel, { kind: "linear", domain: [0, 1], range: [0, 1] });
                } else if (stackExtent && enc.channel === "y") {
                    // Stacked marks span the cumulative extent, not the raw
                    // column range — the zero baseline stays included.
                    scales.set(enc.channel, { kind: "linear", domain: stackExtent, range: [0, 1] });
                } else {
                    // Bar-like marks are measured from a zero baseline, so the
                    // quantitative domain includes zero when values are one-sided.
                    let lo = Math.min(...numeric);
                    let hi = Math.max(...numeric);
                    if (zeroBasedMarks.has(spec.mark)) {
                        if (lo > 0) lo = 0;
                        if (hi < 0) hi = 0;
                    }
                    const domain: [number, number] = [lo, hi];
                    // Default range — caller should override.
                    scales.set(enc.channel, { kind: "linear", domain, range: [0, 1] });
                }
                break;
            }
            case "nominal":
            case "ordinal": {
                // Missing / non-finite cells are not categories; `String(null)`
                // would otherwise become a real "null" / "NaN" band.
                const categories = Array.from(
                    new Set(
                        col.values
                            .filter(
                                (v) =>
                                    v !== null &&
                                    v !== undefined &&
                                    !(typeof v === "number" && !Number.isFinite(v)),
                            )
                            .map((v) => String(v)),
                    ),
                );
                scales.set(enc.channel, { kind: "band", domain: categories, range: [0, categories.length] });
                break;
            }
            default:
                scales.set(enc.channel, { kind: "linear", domain: [0, 1], range: [0, 1] });
        }
    }

    // ── Mark-aware scale overrides (after the auto-derived pass) ────────────
    if (spec.mark === "candlestick" && !spec.scales?.has("y")) {
        const loEnc = spec.encoding.find((e) => e.channel === "low");
        const hiEnc = spec.encoding.find((e) => e.channel === "high");
        const loCol = loEnc ? column(data, loEnc.field) : undefined;
        const hiCol = hiEnc ? column(data, hiEnc.field) : undefined;
        if (loCol && hiCol) {
            const lows = loCol.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            const highs = hiCol.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            if (lows.length > 0 && highs.length > 0) {
                scales.set("y", { kind: "linear", domain: [Math.min(...lows), Math.max(...highs)], range: [0, 1] });
            }
        }
    }
    if (spec.mark === "histogram" && histogramBins.length > 0) {
        if (!spec.scales?.has("x")) {
            scales.set("x", {
                kind: "linear",
                domain: [histogramBins[0].x0, histogramBins[histogramBins.length - 1].x1],
                range: [0, 1],
            });
        }
        if (!spec.scales?.has("y")) {
            const maxCount = Math.max(...histogramBins.map((b) => b.count));
            scales.set("y", { kind: "linear", domain: [0, maxCount > 0 ? maxCount : 1], range: [0, 1] });
        }
    }
    if (spec.mark === "bump" && bumpMaxRank > 0 && !spec.scales?.has("y")) {
        // Rank 1 sits at the top: the domain runs from the worst rank to 1.
        scales.set("y", { kind: "linear", domain: [bumpMaxRank, 1], range: [0, 1] });
    }
    if (spec.mark === "bullet" && !spec.scales?.has("y")) {
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const tEnc = spec.encoding.find((e) => e.channel === "target");
        const rEnc = spec.encoding.find((e) => e.channel === "range");
        let top = 0;
        for (const enc of [yEnc, tEnc, rEnc]) {
            const col = enc ? column(data, enc.field) : undefined;
            if (!col) continue;
            for (const v of col.values) {
                if (typeof v === "number" && Number.isFinite(v) && v > top) top = v;
            }
        }
        scales.set("y", { kind: "linear", domain: [0, top > 0 ? top : 1], range: [0, 1] });
    }
    // Error bars stretch the y domain to cover y ± error, so I-beams never
    // clip at the frame edge; yLow / yHigh bands stretch it the same way.
    {
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const symEnc = spec.encoding.find((e) => e.channel === "yError");
        const minusEnc = spec.encoding.find((e) => e.channel === "yErrorMinus");
        const plusEnc = spec.encoding.find((e) => e.channel === "yErrorPlus");
        const lowEnc = spec.encoding.find((e) => e.channel === "yLow");
        const highEnc = spec.encoding.find((e) => e.channel === "yHigh");
        if (yEnc && (symEnc || minusEnc || plusEnc || lowEnc || highEnc) && !spec.scales?.has("y")) {
            const yCol = column(data, yEnc.field);
            const symCol = symEnc ? column(data, symEnc.field) : undefined;
            const minusCol = minusEnc ? column(data, minusEnc.field) : undefined;
            const plusCol = plusEnc ? column(data, plusEnc.field) : undefined;
            if (yCol) {
                const num = (col: DataColumn | undefined, r: number): number => {
                    if (!col) return NaN;
                    const v = col.values[r];
                    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN;
                };
                let lo = Number.POSITIVE_INFINITY;
                let hi = Number.NEGATIVE_INFINITY;
                for (let r = 0; r < data.rowCount; r++) {
                    const y = yCol.values[r];
                    if (typeof y !== "number" || !Number.isFinite(y)) continue;
                    const sym = num(symCol, r);
                    const minus = num(minusCol, r);
                    const plus = num(plusCol, r);
                    const loV = y - (Number.isFinite(minus) ? minus : Number.isFinite(sym) ? sym : 0);
                    const hiV = y + (Number.isFinite(plus) ? plus : Number.isFinite(sym) ? sym : 0);
                    if (loV < lo) lo = loV;
                    if (hiV > hi) hi = hiV;
                }
                const lowCol = lowEnc ? column(data, lowEnc.field) : undefined;
                const highCol = highEnc ? column(data, highEnc.field) : undefined;
                for (const col of [lowCol, highCol]) {
                    if (!col) continue;
                    for (const v of col.values) {
                        if (typeof v !== "number" || !Number.isFinite(v)) continue;
                        if (v < lo) lo = v;
                        if (v > hi) hi = v;
                    }
                }
                if (lo <= hi) {
                    scales.set("y", { kind: "linear", domain: [lo, hi], range: [0, 1] });
                }
            }
        }
    }

    if (spec.mark === "gantt" && ganttSpans && ganttSpans.size > 0 && !spec.scales?.has("x")) {
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (const [s, e] of ganttSpans.values()) {
            if (s < lo) lo = s;
            if (e > hi) hi = e;
        }
        scales.set("x", { kind: "linear", domain: [lo, hi], range: [0, 1] });
    }
    if (spec.mark === "mosaic") {
        // Mosaic y is the in-slot share domain [0, 1]; x widths come from the
        // per-slot offset / width channels, not from a band scale.
        scales.set("y", { kind: "linear", domain: [0, 1], range: [0, 1] });
    }

    // Rows without a usable required channel never become marks. Marks of
    // stat-driven kinds index into the stat snapshot instead of raw rows.
    const requiredChannels = new Set<string>(basePositionChannels);
    for (const c of markRequiredChannels.get(spec.mark) ?? []) requiredChannels.add(c);

    if (spec.mark === "histogram") {
        for (let i = 0; i < histogramBins.length; i++) {
            const b = histogramBins[i];
            marks.push({
                rowIndex: i,
                key: String(i),
                series: null,
                channels: new Map<string, number | string>([
                    ["x0", b.x0],
                    ["x1", b.x1],
                    ["count", b.count],
                ]),
            });
        }
    } else if (spec.mark === "boxplot" && stat) {
        for (let i = 0; i < boxStatRows.length; i++) {
            const row = boxStatRows[i];
            marks.push({
                rowIndex: i,
                key: row.kind === "box" ? row.cat : `${row.cat}~o${row.j}`,
                series: null,
                channels: new Map<string, number | string>([["category", row.cat]]),
            });
        }
    } else if (spec.mark === "ridgeline" && stat && ridgelineGridSize > 0) {
        ridgelineGroups.forEach((g, gi) => {
            marks.push({
                rowIndex: gi * ridgelineGridSize,
                key: g,
                series: g,
                channels: new Map<string, number | string>([["group", g]]),
            });
        });
    } else if (spec.mark === "violin" && stat) {
        for (const vc of violinCats) {
            marks.push({
                rowIndex: vc.firstStatRow,
                key: vc.cat,
                series: null,
                channels: new Map<string, number | string>([
                    ["category", vc.cat],
                    ["q1", vc.q1],
                    ["median", vc.median],
                    ["q3", vc.q3],
                    ["low", vc.low],
                    ["high", vc.high],
                    ["n", vc.n],
                ]),
            });
        }
    } else if (spec.mark === "force") {
        for (const node of forceNodes) {
            marks.push({
                rowIndex: node.rowIndex,
                key: node.key,
                series: null,
                channels: new Map<string, number | string>([
                    ["x", node.x],
                    ["y", node.y],
                    ["degree", node.degree],
                ]),
            });
        }
    } else if (spec.mark === "hexbin" && stat) {
        for (let i = 0; i < hexCells.length; i++) {
            const c = hexCells[i];
            marks.push({
                rowIndex: i,
                key: String(i),
                series: null,
                channels: new Map<string, number | string>([
                    ["cx", c.cx],
                    ["cy", c.cy],
                    ["count", c.count],
                    ["radius", hexRadius],
                ]),
            });
        }
    } else if (spec.mark === "contour" && stat) {
        contourRings.forEach((ring, i) => {
            marks.push({
                rowIndex: ring.firstStatRow,
                key: `${ring.level}~${i}`,
                series: null,
                channels: new Map<string, number | string>([["level", ring.level]]),
            });
        });
    } else if (spec.mark === "chord") {
        for (const l of chordLinks) {
            marks.push({
                rowIndex: l.rowIndex,
                key: l.key,
                series: null,
                channels: new Map<string, number | string>([
                    ["sa0", l.sa0],
                    ["sa1", l.sa1],
                    ["ta0", l.ta0],
                    ["ta1", l.ta1],
                ]),
            });
        }
    } else if (spec.mark === "calendar" && stat) {
        const dateColS = column(stat, "date");
        const weekColS = column(stat, "week");
        const weekdayColS = column(stat, "weekday");
        const valueColS = column(stat, "value");
        const usedCalKeys = new Set<string>();
        for (let i = 0; i < stat.rowCount; i++) {
            const date = String(dateColS?.values[i] ?? i);
            let key = date;
            if (usedCalKeys.has(key)) key = `${date}~${i}`;
            usedCalKeys.add(key);
            marks.push({
                rowIndex: i,
                key,
                series: null,
                channels: new Map<string, number | string>([
                    ["date", date],
                    ["week", Number(weekColS?.values[i])],
                    ["weekday", Number(weekdayColS?.values[i])],
                    ["value", Number(valueColS?.values[i])],
                ]),
            });
        }
    } else {
    // Build one mark per usable row, applying scales.
    for (let r = 0; r < data.rowCount; r++) {
        const channels = new Map<string, number | string>();
        let positioned = true;

        // Row identity: keyField value when usable, positional otherwise.
        // Duplicates keep the first occurrence and disambiguate later ones.
        const rawKey = keyCol ? (keyCol.values[r] ?? null) : null;
        const keyUsable =
            rawKey !== null &&
            rawKey !== undefined &&
            !(typeof rawKey === "number" && !Number.isFinite(rawKey));
        let key = keyUsable ? String(rawKey) : String(r);
        if (usedKeys.has(key)) {
            diagnostics.push(
                diag(
                    "warning",
                    "davinci.chart.duplicate-key",
                    `keyField "${spec.keyField}" gives duplicate key "${key}" for row ${r}`,
                    `${spec.keyField}#${r}`,
                ),
            );
            key = `${key}~${r}`;
        }
        usedKeys.add(key);

        // Series group for this row (null when ungrouped or the cell is not a
        // real category — never the strings "null" / "NaN").
        const rawSeries = legendCol ? (legendCol.values[r] ?? null) : null;
        const seriesUsable =
            rawSeries !== null &&
            rawSeries !== undefined &&
            !(typeof rawSeries === "number" && !Number.isFinite(rawSeries));
        const series = seriesUsable ? String(rawSeries) : null;
        for (const enc of spec.encoding) {
            const col = column(data, enc.field);
            if (!col) continue;
            const raw = col.values[r] ?? null;
            const scale = scales.get(enc.channel);

            if (raw === null || raw === undefined) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.missing-value",
                        `field "${enc.field}" has no value for row ${r}`,
                        `${enc.field}#${r}`,
                    ),
                );
                if (requiredChannels.has(enc.channel)) positioned = false;
                continue;
            }
            if (!isFiniteValue(raw, scale)) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.non-finite-value",
                        `field "${enc.field}" is not a finite number for row ${r} (${String(raw)})`,
                        `${enc.field}#${r}`,
                    ),
                );
                if (requiredChannels.has(enc.channel)) positioned = false;
                continue;
            }
            // Pie slices are shares of a whole — a negative value has no
            // angle and is dropped with a warning, never drawn backwards.
            if (spec.mark === "pie" && enc.channel === "theta" && typeof raw === "number" && raw < 0) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.negative-slice",
                        `field "${enc.field}" is negative for row ${r} (${raw}); pie slices need non-negative shares`,
                        `${enc.field}#${r}`,
                    ),
                );
                positioned = false;
                continue;
            }
            // Rose petals and radial-bar sweeps map value to radius / angle —
            // a negative value has neither and is dropped with a warning.
            if (
                (spec.mark === "rose" || spec.mark === "radial-bar" || spec.mark === "funnel") &&
                enc.channel === "y" &&
                typeof raw === "number" &&
                raw < 0
            ) {
                diagnostics.push(
                    diag(
                        "warning",
                        "davinci.chart.negative-slice",
                        `field "${enc.field}" is negative for row ${r} (${raw}); "${String(spec.mark)}" needs non-negative values`,
                        `${enc.field}#${r}`,
                    ),
                );
                positioned = false;
                continue;
            }

            if (scale) {
                const scaleKey = scale.kind === "band" || scale.kind === "point" ? String(raw) : raw;
                channels.set(enc.channel, applyScale(scale, scaleKey));
            } else if (typeof raw === "number") channels.set(enc.channel, raw);
            else channels.set(enc.channel, String(raw));
        }
        // Bump ranks and treemap subtree sums join the mark's channels — the
        // scene and hosts read them as data, never recompute them.
        if (spec.mark === "bump" && bumpRanks) {
            const rank = bumpRanks.get(r);
            if (rank !== undefined) channels.set("rank", rank);
        }
        if ((spec.mark === "treemap" || spec.mark === "sunburst") && treemapSubtree) {
            channels.set("subtree", treemapSubtree.get(r) ?? 0);
        }
        // Strip charts jitter deterministically from the row key, so SSR and
        // hydration agree on every offset.
        if (spec.mark === "strip") {
            channels.set("jitter", hash01(key) - 0.5);
        }
        if (spec.mark === "mosaic" && mosaicOffsets && mosaicWidths && mosaicShares) {
            const xEnc2 = spec.encoding.find((e) => e.channel === "x");
            const xRaw = xEnc2 ? column(data, xEnc2.field)?.values[r] : null;
            const xKey = xRaw === null || xRaw === undefined ? "" : String(xRaw);
            const share = mosaicShares.get(r);
            if (share !== undefined) {
                channels.set("share", share);
                channels.set("xOffset", mosaicOffsets.get(xKey) ?? 0);
                channels.set("xWidth", mosaicWidths.get(xKey) ?? 0);
            } else {
                positioned = false;
            }
        }
        if (layout === "percent" && percentShares) {
            const share = percentShares.get(r);
            if (share !== undefined) channels.set("share", share);
        }
        if (spec.mark === "gantt" && ganttSpans) {
            const span = ganttSpans.get(r);
            if (!span) {
                positioned = false;
            } else {
                channels.set("startV", span[0]);
                channels.set("endV", span[1]);
            }
        }
        // Parallel coordinates: a row missing any dimension value draws no
        // polyline at all.
        if (spec.mark === "parallel") {
            for (const d of parallelDims) {
                const col = column(data, d.dim);
                const v = col ? col.values[r] : null;
                if (typeof v !== "number" || !Number.isFinite(v)) {
                    positioned = false;
                    break;
                }
            }
        }
        // Geo: a region row with no basemap feature draws nothing (compile
        // already warned about it); matched rows carry their feature name so
        // iso-matched rows still find their fill value at scene time.
        if (spec.mark === "geo" && geoMatched) {
            if (!geoMatched.has(r)) {
                positioned = false;
            } else {
                const feature = geoFeatureOf?.get(r);
                if (feature !== undefined) channels.set("feature", feature);
            }
        }
        // Rows without a usable x / y position never become marks; the rest
        // still keep their original row index and key so ids do not renumber.
        if (positioned) {
            if (stackOffsets) {
                marks.push({ rowIndex: r, key, series, channels, stackBase: stackOffsets.get(r) ?? 0 });
            } else {
                marks.push({ rowIndex: r, key, series, channels });
            }
        }
    }
    }

    const seriesDomain: SeriesDomain = { field: legendCol ? (legendEnc?.field ?? null) : null, categories: seriesCategories };
    return { spec, resolvedData: data, scales, marks, series: seriesDomain, stat, diagnostics: { items: diagnostics } };
}

/** Both log-domain endpoints must be finite and strictly positive —
 *  `log(0)` / `log(negative)` is not a real position and a non-finite
 *  endpoint poisons the whole mapping. */
function isLogDomainUsable(domain: readonly [number, number]): boolean {
    return Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[0] > 0 && domain[1] > 0;
}

/** Deterministic string hash into [0, 1) — FNV-1a 32-bit. Powers strip-chart
 *  jitter that SSR and hydration reproduce identically. */
function hash01(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 4294967296;
}

/** Parse a strict `YYYY-MM-DD` date into epoch days; anything else is null. */
function parseCalendarDate(raw: number | string | boolean | null): number | null {
    if (typeof raw !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, mo - 1, d);
    const check = new Date(ms);
    if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return ms / 86400000;
}

/** Day of week for an epoch-day number (0 = Sunday, matching Date#getUTCDay). */
function weekdayOfDays(days: number): number {
    return new Date(days * 86400000).getUTCDay();
}

/** Gantt span endpoint: a finite number, or a strict `YYYY-MM-DD` date string
 *  converted to epoch days. Anything else is null. */
function parseGanttValue(raw: number | string | boolean | null): number | null {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    return parseCalendarDate(raw);
}

/** Geo projector: lon/lat degrees → planar units for the chosen projection. */
function geoProjector(kind: "mercator" | "equirectangular" | "albers"): (lon: number, lat: number) => [number, number] {
    const rad = Math.PI / 180;
    switch (kind) {
        case "mercator":
            return (lon, lat) => {
                const phi = Math.max(-85, Math.min(85, lat)) * rad;
                return [lon * rad, -Math.log(Math.tan(Math.PI / 4 + phi / 2))];
            };
        case "equirectangular":
            return (lon, lat) => [lon * rad, -lat * rad];
        case "albers": {
            // d3 default parallels (29.5° / 45.5° N) and origin (96° W, 23° N).
            const phi0 = 29.5 * rad;
            const phi1 = 45.5 * rad;
            const lat0 = 23 * rad;
            const lon0 = -96 * rad;
            const n = (Math.sin(phi0) + Math.sin(phi1)) / 2;
            const c = Math.cos(phi0) * Math.cos(phi0) + 2 * n * Math.sin(phi0);
            const rho0 = Math.sqrt(c - 2 * n * Math.sin(lat0)) / n;
            return (lon, lat) => {
                const rho = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(lat * rad))) / n;
                const theta = n * (lon * rad - lon0);
                return [rho * Math.sin(theta), -(rho0 - rho * Math.cos(theta))];
            };
        }
    }
}

/** Signed area of a ring in projected coordinates (winding probe). */
function signedRingArea(pts: ReadonlyArray<readonly [number, number]>): number {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        sum += x0 * y1 - x1 * y0;
    }
    return sum / 2;
}

/** Marching squares over a density grid: joins threshold segments into closed
 *  rings (case table walks each cell edge once, then stitches by shared
 *  endpoints). Deterministic for a given grid. */
function marchingSquares(
    field: Float64Array,
    size: number,
    gx: ReadonlyArray<number>,
    gy: ReadonlyArray<number>,
    level: number,
): { x: number; y: number }[][] {
    const at = (i: number, j: number): number => field[j * size + i];
    const lerp = (a: number, b: number, va: number, vb: number): number => (Math.abs(vb - va) < 1e-12 ? 0.5 : (level - va) / (vb - va));
    // Edge endpoints are keyed so segments stitch into rings.
    const segments: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (let j = 0; j < size - 1; j++) {
        for (let i = 0; i < size - 1; i++) {
            const v0 = at(i, j);
            const v1 = at(i + 1, j);
            const v2 = at(i + 1, j + 1);
            const v3 = at(i, j + 1);
            let idx = 0;
            if (v0 > level) idx |= 1;
            if (v1 > level) idx |= 2;
            if (v2 > level) idx |= 4;
            if (v3 > level) idx |= 8;
            if (idx === 0 || idx === 15) continue;
            const top = { x: gx[i] + lerp(0, 1, v0, v1) * (gx[i + 1] - gx[i]), y: gy[j] };
            const right = { x: gx[i + 1], y: gy[j] + lerp(0, 1, v1, v2) * (gy[j + 1] - gy[j]) };
            const bottom = { x: gx[i] + lerp(0, 1, v3, v2) * (gx[i + 1] - gx[i]), y: gy[j + 1] };
            const left = { x: gx[i], y: gy[j] + lerp(0, 1, v0, v3) * (gy[j + 1] - gy[j]) };
            switch (idx) {
                case 1:
                case 14:
                    segments.push({ a: left, b: top });
                    break;
                case 2:
                case 13:
                    segments.push({ a: top, b: right });
                    break;
                case 3:
                case 12:
                    segments.push({ a: left, b: right });
                    break;
                case 4:
                case 11:
                    segments.push({ a: right, b: bottom });
                    break;
                case 5:
                    segments.push({ a: left, b: top });
                    segments.push({ a: right, b: bottom });
                    break;
                case 6:
                case 9:
                    segments.push({ a: top, b: bottom });
                    break;
                case 7:
                case 8:
                    segments.push({ a: left, b: bottom });
                    break;
                case 10:
                    segments.push({ a: top, b: right });
                    segments.push({ a: left, b: bottom });
                    break;
            }
        }
    }
    // Stitch segments into rings by consuming shared endpoints. A shared cell
    // edge is computed identically on both sides, so endpoints match exactly.
    const keyOf = (p: { x: number; y: number }): string => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const remaining = [...segments];
    const rings: { x: number; y: number }[][] = [];
    while (remaining.length > 0) {
        const first = remaining.shift()!;
        const ring = [first.a, first.b];
        let end = first.b;
        let closed = false;
        for (let guard = 0; guard < segments.length + 2; guard++) {
            if (keyOf(end) === keyOf(first.a)) {
                closed = true;
                break;
            }
            const idx = remaining.findIndex((s) => keyOf(s.a) === keyOf(end) || keyOf(s.b) === keyOf(end));
            if (idx < 0) break;
            const seg = remaining.splice(idx, 1)[0];
            const next = keyOf(seg.a) === keyOf(end) ? seg.b : seg.a;
            ring.push(next);
            end = next;
        }
        if (closed && ring.length >= 4) rings.push(ring.slice(0, -1));
    }
    return rings;
}

/** Whether a raw cell can be turned into a finite number (or a real category). */
function isFiniteValue(value: number | string | boolean, scale: Scale | undefined): boolean {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    // Band / point domains are built from the column itself, so any string is
    // a real category — otherwise it must parse as a finite number.
    if (scale && (scale.kind === "band" || scale.kind === "point")) return true;
    return Number.isFinite(Number(value));
}

function applyScale(scale: Scale, value: number | string | boolean | null): number | string {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "boolean") return scaleApply(scale, value ? 1 : 0);
    return scaleApply(scale, value as number | string);
}

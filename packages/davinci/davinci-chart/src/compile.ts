// Chart compile — ChartSpec + DataSnapshot → ChartCompilePlan.
//
// ChartCompilePlan is the resolved stage between domain spec and scene. It
// contains fully-instantiated scales, resolved encodings, one row per mark
// (after statistics / faceting) plus the diagnostics raised while reading the
// data. The plan does NOT carry scene shapes — those are produced by the scene
// builder.

import { diag, type Diagnostic, type DiagnosticSet } from "@doki-land/davinci-types";
import { column, fromRows, type DataColumn, type DataSnapshot } from "./data.js";
import { apply as scaleApply, type Scale } from "./scale.js";
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
    | "bullet";

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
     *  separately from the zero baseline (bars and areas only). */
    readonly seriesLayout?: "overlap" | "stack" | "dodge";
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
    /** Gauge only: the [min, max] the sweep spans; defaults to [0, 100]. */
    readonly valueDomain?: readonly [number, number];
    /** Sparkline mode: strip axes, grid and legend for tiny inline charts. */
    readonly spark?: boolean;
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
const zeroBasedMarks: ReadonlySet<MarkKind> = new Set(["bar", "rect", "area", "radar", "bullet", "rose"]);

/** Channels whose value decides whether a row can be positioned at all. */
const basePositionChannels: ReadonlySet<string> = new Set(["x", "y", "theta"]);

/** Extra channels a mark requires for a row to be drawable at all. */
const markRequiredChannels: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
    ["candlestick", ["open", "high", "low", "close"]],
    ["heatmap", ["color"]],
    ["sankey", ["source", "target", "value"]],
    ["treemap", ["size"]],
    ["bullet", ["target"]],
]);

/** Mark kinds whose `color` encoding is a quantitative value channel, not a
 *  series grouping (heatmap cells read color as data). */
const colorAsValueMarks: ReadonlySet<string> = new Set(["heatmap"]);

/** Mark kinds whose legend / palette comes from a positional category field
 *  instead of a series encoding: ridgeline ridges and rose / radial-bar /
 *  funnel categories are colored per category. */
const categorySeriesField: ReadonlyMap<string, string> = new Map([
    ["ridgeline", "y"],
    ["rose", "x"],
    ["radial-bar", "x"],
    ["funnel", "x"],
]);

/** Marks whose statistics are computed globally — faceting them would need
 *  per-panel statistics, which is a separate contract. */
const statDrivenMarks: ReadonlySet<string> = new Set(["histogram", "boxplot", "ridgeline", "bump"]);

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
]);

/** Resolve the effective series layout. `undefined` is the natural per-mark
 *  default: grouped bars dodge, everything else overlaps. */
export function resolveSeriesLayout(spec: ChartSpec, hasSeries: boolean): "overlap" | "stack" | "dodge" {
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

    // Treemap hierarchy: ids from keyField, parents from parentField. Orphans
    // hang at the root with a warning; cycles are an error; a parent row's own
    // size is ignored (its value is the sum of its leaves) with a warning.
    let treemapSubtree: Map<number, number> | null = null;
    if (spec.mark === "treemap") {
        if (!spec.keyField) {
            diagnostics.push(
                diag("error", "davinci.chart.treemap-needs-key", `treemap needs keyField naming the id field`, "keyField"),
            );
        }
        if (!spec.parentField) {
            diagnostics.push(
                diag(
                    "error",
                    "davinci.chart.treemap-needs-parent",
                    `treemap needs parentField naming the parent id field`,
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
                        "davinci.chart.treemap-orphan",
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
                    diag("error", "davinci.chart.treemap-cycle", `treemap hierarchy contains a cycle`, spec.parentField),
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
                        "davinci.chart.treemap-parent-value",
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
    // clip at the frame edge.
    {
        const yEnc = spec.encoding.find((e) => e.channel === "y");
        const symEnc = spec.encoding.find((e) => e.channel === "yError");
        const minusEnc = spec.encoding.find((e) => e.channel === "yErrorMinus");
        const plusEnc = spec.encoding.find((e) => e.channel === "yErrorPlus");
        if (yEnc && (symEnc || minusEnc || plusEnc) && !spec.scales?.has("y")) {
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
                if (lo <= hi) {
                    scales.set("y", { kind: "linear", domain: [lo, hi], range: [0, 1] });
                }
            }
        }
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
        if (spec.mark === "treemap" && treemapSubtree) {
            channels.set("subtree", treemapSubtree.get(r) ?? 0);
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

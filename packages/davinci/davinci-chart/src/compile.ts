// Chart compile — ChartSpec + DataSnapshot → ChartCompilePlan.
//
// ChartCompilePlan is the resolved stage between domain spec and scene. It
// contains fully-instantiated scales, resolved encodings, one row per mark
// (after statistics / faceting) plus the diagnostics raised while reading the
// data. The plan does NOT carry scene shapes — those are produced by the scene
// builder.

import { diag, type Diagnostic, type DiagnosticSet } from "@doki-land/davinci-types";
import { column, type DataSnapshot } from "./data.js";
import { apply as scaleApply, type Scale } from "./scale.js";

/** Mark kind (geometric primitive family). Only marks with real scene
 *  geometry are listed — an authoring surface can never name a mark the
 *  engine would silently drop. */
export type MarkKind = "point" | "line" | "rect" | "bar" | "circle" | "area" | "pie" | "radar";

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
    /** Data problems found while compiling — row-level, never fatal to the host. */
    readonly diagnostics: DiagnosticSet;
}

/** Encoding channels that group marks into series. */
const seriesChannels: ReadonlySet<string> = new Set(["series", "color", "group"]);

/** Mark kinds measured from a zero baseline. */
const zeroBasedMarks: ReadonlySet<MarkKind> = new Set(["bar", "rect", "area", "radar"]);

/** Channels whose value decides whether a row can be positioned at all. */
const positionChannels: ReadonlySet<string> = new Set(["x", "y", "theta"]);

/** Mark kinds with real scene geometry. Kept in sync with the scene
 *  builder; `compile` refuses anything else instead of rendering an empty
 *  chart with no explanation. */
const implementedMarks: ReadonlySet<string> = new Set(["bar", "rect", "line", "point", "circle", "area", "pie", "radar"]);

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
                `mark "${String(spec.mark)}" has no scene geometry; implemented marks are bar, rect, line, point, circle, area, pie, radar`,
                String(spec.mark),
            ),
        );
    }

    // Resolve the grouping domain once: first-appearance category order is a
    // contract (legend and palette index marks by it), so it is computed here,
    // not re-derived by the scene builder.
    const seriesEnc = spec.encoding.find((e) => seriesChannels.has(e.channel));
    const seriesCol = seriesEnc ? column(data, seriesEnc.field) : undefined;
    const seriesCategories: string[] = [];
    if (seriesCol) {
        const seenSeries = new Set<string>();
        for (const v of seriesCol.values) {
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
    const layout = resolveSeriesLayout(spec, seriesCol !== undefined);
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
    if (spec.seriesLayout && !seriesCol) {
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
        if (xCol && yCol && seriesCol) {
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
                        const cell = seriesCol.values[r];
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
        const rawSeries = seriesCol ? (seriesCol.values[r] ?? null) : null;
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
                if (positionChannels.has(enc.channel)) positioned = false;
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
                if (positionChannels.has(enc.channel)) positioned = false;
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

            if (scale) {
                const scaleKey = scale.kind === "band" || scale.kind === "point" ? String(raw) : raw;
                channels.set(enc.channel, applyScale(scale, scaleKey));
            } else if (typeof raw === "number") channels.set(enc.channel, raw);
            else channels.set(enc.channel, String(raw));
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

    const seriesDomain: SeriesDomain = { field: seriesCol ? (seriesEnc?.field ?? null) : null, categories: seriesCategories };
    return { spec, resolvedData: data, scales, marks, series: seriesDomain, diagnostics: { items: diagnostics } };
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

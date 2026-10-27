// Chart compile — ChartSpec + DataSnapshot → ChartCompilePlan.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §6.
//
// ChartCompilePlan is the resolved stage between domain spec and scene. It
// contains fully-instantiated scales, resolved encodings, one row per mark
// (after statistics / faceting) plus the diagnostics raised while reading the
// data. The plan does NOT carry scene shapes — those are produced by the scene
// builder.

import { diag, type Diagnostic, type DiagnosticSet } from "@doki-land/davinci-types";
import { column, type DataSnapshot } from "./data.js";
import { apply as scaleApply, type Scale } from "./scale.js";

/** Mark kind (geometric primitive family). */
export type MarkKind = "point" | "line" | "rect" | "bar" | "circle" | "area" | "text" | "tick";

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
    /** Facet field (optional — produces one plan row per facet). */
    readonly facetField?: string;
}

/** One resolved mark instance in the plan — will become one Scene node. */
export interface PlanMark {
    /** Row index in the resolved data. */
    readonly rowIndex: number;
    /** Encoded channel values (scale-applied). */
    readonly channels: ReadonlyMap<string, number | string>;
}

/** Full compile plan — scene builder consumes this. */
export interface ChartCompilePlan {
    readonly spec: ChartSpec;
    readonly resolvedData: DataSnapshot;
    readonly scales: ReadonlyMap<string, Scale>;
    readonly marks: ReadonlyArray<PlanMark>;
    /** Data problems found while compiling — row-level, never fatal to the host. */
    readonly diagnostics: DiagnosticSet;
}

/** Mark kinds measured from a zero baseline. */
const zeroBasedMarks: ReadonlySet<MarkKind> = new Set(["bar", "rect", "area"]);

/** Channels whose value decides whether a row can be positioned at all. */
const positionChannels: ReadonlySet<string> = new Set(["x", "y"]);

/** Compile a ChartSpec against a DataSnapshot. */
export function compile(spec: ChartSpec, data: DataSnapshot): ChartCompilePlan {
    const scales = new Map<string, Scale>();
    const marks: PlanMark[] = [];
    const diagnostics: Diagnostic[] = [];

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
            scales.set(enc.channel, spec.scales.get(enc.channel)!);
            continue;
        }
        switch (col.semantic) {
            case "quantitative": {
                const numeric = col.values.filter(
                    (v): v is number => typeof v === "number" && Number.isFinite(v),
                );
                if (numeric.length === 0) {
                    scales.set(enc.channel, { kind: "linear", domain: [0, 1], range: [0, 1] });
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

            if (scale) {
                const key = scale.kind === "band" || scale.kind === "point" ? String(raw) : raw;
                channels.set(enc.channel, applyScale(scale, key));
            } else if (typeof raw === "number") channels.set(enc.channel, raw);
            else channels.set(enc.channel, String(raw));
        }
        // Rows without a usable x / y position never become marks; the rest
        // still keep their original row index so ids do not renumber.
        if (positioned) marks.push({ rowIndex: r, channels });
    }

    return { spec, resolvedData: data, scales, marks, diagnostics: { items: diagnostics } };
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

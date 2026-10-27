// Chart compile — ChartSpec + DataSnapshot → ChartCompilePlan.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §6.
//
// ChartCompilePlan is the resolved stage between domain spec and scene. It
// contains fully-instantiated scales, resolved encodings, and one row per
// mark (after statistics / faceting). The plan does NOT carry scene shapes
// — those are produced by the scene builder.

import type { DataSnapshot } from "./data.js";
import type { Scale } from "./scale.js";

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
}

/** Mark kinds measured from a zero baseline. */
const zeroBasedMarks: ReadonlySet<MarkKind> = new Set(["bar", "rect", "area"]);

/** Compile a ChartSpec against a DataSnapshot. */
export function compile(spec: ChartSpec, data: DataSnapshot): ChartCompilePlan {
    const scales = new Map<string, Scale>();
    const marks: PlanMark[] = [];

    for (const enc of spec.encoding) {
        const col = data.columns.find((c) => c.name === enc.field);
        if (!col) continue;
        // Auto-derive scales based on field semantics (simple heuristic).
        if (spec.scales?.has(enc.channel)) {
            scales.set(enc.channel, spec.scales.get(enc.channel)!);
            continue;
        }
        switch (col.semantic) {
            case "quantitative": {
                const numeric = col.values.filter((v): v is number => typeof v === "number");
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
                const cats = Array.from(new Set(col.values.map((v) => String(v))));
                scales.set(enc.channel, { kind: "band", domain: cats, range: [0, cats.length] });
                break;
            }
            default:
                scales.set(enc.channel, { kind: "linear", domain: [0, 1], range: [0, 1] });
        }
    }

    // Build one mark per row, applying scales.
    for (let r = 0; r < data.rowCount; r++) {
        const channels = new Map<string, number | string>();
        for (const enc of spec.encoding) {
            const col = data.columns.find((c) => c.name === enc.field);
            if (!col) continue;
            const raw = col.values[r];
            const scale = scales.get(enc.channel);
            if (scale) {
                channels.set(enc.channel, applyScale(scale, raw));
            } else if (typeof raw === "number") {
                channels.set(enc.channel, raw);
            } else {
                channels.set(enc.channel, String(raw));
            }
        }
        marks.push({ rowIndex: r, channels });
    }

    return { spec, resolvedData: data, scales, marks };
}

function applyScale(scale: Scale, value: number | string | boolean | null): number | string {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "boolean") return scaleApply(scale, value ? 1 : 0);
    return scaleApply(scale, value as number | string);
}

// Scale import at end to avoid circular deps in this module's own scope.
import { apply as scaleApply } from "./scale.js";

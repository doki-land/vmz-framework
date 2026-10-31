// Scale types — domain → range mapping.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §6.

/** Scale family. */
export type ScaleKind = "linear" | "band" | "point" | "log" | "quantile";

/** Continuous domain → continuous range. */
export interface LinearScale {
    readonly kind: "linear";
    readonly domain: [number, number];
    readonly range: [number, number];
    /** Clip to range when true (default true). */
    readonly clamp?: boolean;
}

/** Discrete domain → continuous range with padding. */
export interface BandScale {
    readonly kind: "band";
    readonly domain: ReadonlyArray<string>;
    readonly range: [number, number];
    readonly padding?: number;
}

/** Like band but points are center-aligned (no bandwidth). */
export interface PointScale {
    readonly kind: "point";
    readonly domain: ReadonlyArray<string>;
    readonly range: [number, number];
    readonly padding?: number;
}

/** Logarithmic continuous domain → continuous range. */
export interface LogScale {
    readonly kind: "log";
    readonly domain: [number, number];
    readonly range: [number, number];
    readonly base?: number;
}

/** Quantile — maps sorted quantitative domain values to discrete thresholds. */
export interface QuantileScale {
    readonly kind: "quantile";
    readonly domain: ReadonlyArray<number>;
    readonly range: ReadonlyArray<number>;
}

export type Scale = LinearScale | BandScale | PointScale | LogScale | QuantileScale;

// ─── Scale applications ──────────────────────────────────────────────────

export function apply(s: Scale, value: number | string): number {
    switch (s.kind) {
        case "linear": {
            const t = (typeof value === "number" ? value : Number(value)) as number;
            const [d0, d1] = s.domain;
            const [r0, r1] = s.range;
            const v = ((t - d0) / (d1 - d0)) * (r1 - r0) + r0;
            if (s.clamp !== false) return Math.min(Math.max(v, Math.min(r0, r1)), Math.max(r0, r1));
            return v;
        }
        case "log": {
            const base = s.base ?? 10;
            const b0 = Math.log(s.domain[0]) / Math.log(base);
            const b1 = Math.log(s.domain[1]) / Math.log(base);
            const bt = Math.log((value as number)) / Math.log(base);
            const t = (bt - b0) / (b1 - b0);
            const [r0, r1] = s.range;
            return t * (r1 - r0) + r0;
        }
        case "band":
        case "point": {
            const idx = s.domain.indexOf(value as string);
            if (idx < 0) return NaN;
            const padding = s.padding ?? 0;
            const [r0, r1] = s.range;
            const inner = r1 - r0;
            if (s.kind === "band") {
                const step = inner / s.domain.length;
                return r0 + idx * step + padding * step;
            } else {
                // Point — evenly spaced including ends.
                if (s.domain.length === 1) return (r0 + r1) / 2;
                const step = inner / (s.domain.length - 1 + padding * 2);
                return r0 + (idx + padding) * step;
            }
        }
        case "quantile": {
            const sorted = [...s.domain].sort((a, b) => a - b);
            const q = (value as number);
            let lo = 0;
            let hi = sorted.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (sorted[mid] <= q) lo = mid + 1;
                else hi = mid;
            }
            const t = sorted.length === 1 ? 0 : lo / (sorted.length - 1);
            // Interpolate range thresholds.
            if (s.range.length === 1) return s.range[0];
            const ir = t * (s.range.length - 1);
            const i0 = Math.min(Math.floor(ir), s.range.length - 1);
            const i1 = Math.min(i0 + 1, s.range.length - 1);
            const frac = ir - i0;
            return s.range[i0] + frac * (s.range[i1] - s.range[i0]);
        }
    }
}

/** Bandwidth for band scales (0 for others). */
export function bandwidth(s: Scale): number {
    if (s.kind !== "band") return 0;
    const padding = s.padding ?? 0;
    const [r0, r1] = s.range;
    const step = (r1 - r0) / s.domain.length;
    return step * (1 - padding * 2);
}

// ─── Tick generation (scale concern: domain values → tick values) ────────

const MAX_TICKS = 12;
const MAX_TICK_DECIMALS = 6;

/** 4–6 evenly spaced "nice" values covering the domain (single value when
 *  flat). Tick placement is derived from the domain, never from a hardcoded
 *  list, so axes stay honest when data changes. */
export function niceLinearTicks(domain: [number, number]): { values: number[]; decimals: number } {
    let [lo, hi] = domain;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { values: [], decimals: 0 };
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) {
        const single = normalizeTickNumber(lo);
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
        values.push(normalizeTickNumber(i * step));
    }
    if (values.length === 0) values.push(normalizeTickNumber((lo + hi) / 2));
    return { values, decimals };
}

/** Minimal-decimal label for a tick value — trailing zeros dropped, never
 *  `-0`, never a floating point tail. */
export function formatTickLabel(value: number, decimals: number): string {
    if (!Number.isFinite(value)) return "";
    const places = Math.min(Math.max(decimals, 0), MAX_TICK_DECIMALS);
    let text = value.toFixed(places);
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text === "-0" ? "0" : text;
}

function decimalsForStep(step: number): number {
    if (!(step > 0) || !Number.isFinite(step)) return 0;
    let decimals = 0;
    while (decimals < MAX_TICK_DECIMALS && Math.abs(Number(step.toFixed(decimals)) - step) > step * 1e-6) {
        decimals += 1;
    }
    return decimals;
}

/** Kill floating point tails such as 0.30000000000000004. */
function normalizeTickNumber(value: number): number {
    return Number(value.toPrecision(12));
}

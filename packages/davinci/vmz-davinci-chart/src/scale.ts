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

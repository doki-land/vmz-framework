// Statistics — column aggregation for chart transforms.

export type AggregateKind = "count" | "sum" | "mean" | "min" | "max" | "median";

/** Type-7 quantile (R / numpy default): h = 1 + (n-1)p, linear interpolation
 *  between the bracketing order statistics. `sorted` must be ascending. */
export function quantile(sorted: ReadonlyArray<number>, p: number): number {
    if (sorted.length === 0) return NaN;
    if (sorted.length === 1) return sorted[0];
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Five-number summary for one boxplot group. Whiskers are the most extreme
 *  points inside the 1.5·IQR fences; anything beyond is an outlier. */
export interface BoxStats {
    readonly low: number;
    readonly q1: number;
    readonly median: number;
    readonly q3: number;
    readonly high: number;
    readonly n: number;
    readonly outliers: ReadonlyArray<number>;
}

export function boxStats(values: ReadonlyArray<number | string | boolean | null>): BoxStats | null {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (nums.length === 0) return null;
    const q1 = quantile(nums, 0.25);
    const median = quantile(nums, 0.5);
    const q3 = quantile(nums, 0.75);
    const iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr;
    const hiFence = q3 + 1.5 * iqr;
    const inside = nums.filter((v) => v >= loFence && v <= hiFence);
    const outliers = nums.filter((v) => v < loFence || v > hiFence);
    return {
        low: inside.length > 0 ? inside[0] : nums[0],
        q1,
        median,
        q3,
        high: inside.length > 0 ? inside[inside.length - 1] : nums[nums.length - 1],
        n: nums.length,
        outliers,
    };
}

/** One histogram bin — half-open [x0, x1) except the last bin, which is
 *  closed so the maximum value lands inside a real bin. */
export interface HistogramBin {
    readonly x0: number;
    readonly x1: number;
    readonly count: number;
}

export interface HistogramResult {
    readonly bins: ReadonlyArray<HistogramBin>;
    readonly binWidth: number;
}

/** Bin finite values into equal-width bins. The width targets the
 *  Freedman–Diaconis rule, falls back to sqrt(n), and is snapped to a nice
 *  1/2/5·10^k step so axis ticks stay honest. Edges align to bin-width
 *  multiples. Flat data collapses into a single bin. */
export function binValues(values: ReadonlyArray<number | string | boolean | null>, maxBins: number = 80): HistogramResult {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (nums.length === 0) return { bins: [], binWidth: 1 };
    const lo = nums[0];
    const hi = nums[nums.length - 1];
    if (lo === hi) return { bins: [{ x0: lo, x1: hi, count: nums.length }], binWidth: 1 };

    const iqr = quantile(nums, 0.75) - quantile(nums, 0.25);
    const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(nums.length) : 0;
    const sqrtW = (hi - lo) / Math.max(1, Math.ceil(Math.sqrt(nums.length)));
    const target = fd > 0 && Number.isFinite(fd) ? Math.min(fd, sqrtW > 0 ? sqrtW : fd) : sqrtW;
    const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
    const normalized = target / magnitude;
    let width = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    if (!Number.isFinite(width) || width <= 0) width = (hi - lo) / 10;
    // Cap the bin count so pathological widths never flood the scene.
    while ((hi - lo) / width> maxBins) width *= 2;

    const start = Math.floor(lo / width) * width;
    const binCount = Math.max(1, Math.ceil((hi - start) / width));
    const counts = new Array<number>(binCount).fill(0);
    for (const v of nums) {
        const idx = Math.min(binCount - 1, Math.floor((v - start) / width));
        counts[idx]++;
    }
    const bins: HistogramBin[] = counts.map((count, i) => ({ x0: start + i * width, x1: start + (i + 1) * width, count }));
    return { bins, binWidth: width };
}

/** Silverman's rule-of-thumb bandwidth for Gaussian KDE: 0.9·min(σ, IQR/1.34)·n^(−1/5).
 *  Degenerate spreads fall back to range/20 so the kernel never collapses. */
export function silvermanBandwidth(values: ReadonlyArray<number | string | boolean | null>): number {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (nums.length < 2) return 1;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nums.length;
    const sd = Math.sqrt(variance);
    const iqr = quantile(nums, 0.75) - quantile(nums, 0.25);
    const spread = Math.min(sd > 0 ? sd : Number.POSITIVE_INFINITY, iqr > 0 ? iqr / 1.34 : Number.POSITIVE_INFINITY);
    const range = nums[nums.length - 1] - nums[0];
    const base = Number.isFinite(spread) ? spread : range > 0 ? range : 1;
    const h = 0.9 * base * Math.pow(nums.length, -1 / 5);
    if (!Number.isFinite(h) || h <= 0) return range > 0 ? range / 20 : 1;
    return h;
}

/** Gaussian kernel density estimate on a shared grid. The area under the
 *  returned curve integrates to 1 (up to grid resolution). */
export function kde(values: ReadonlyArray<number | string | boolean | null>, grid: ReadonlyArray<number>, bandwidth: number): number[] {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const n = nums.length;
    if (n === 0 || !(bandwidth > 0)) return grid.map(() => 0);
    const inv = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
    return grid.map((x) => {
        let sum = 0;
        for (const v of nums) {
            const t = (x - v) / bandwidth;
            if (t > 5 || t < -5) continue;
            sum += Math.exp(-0.5 * t * t);
        }
        return sum * inv;
    });
}

/** Competition ranking ("1224"): ties share the minimum rank, rank 1 is the
 *  largest value. Non-finite values get no rank. */
export function rankDescending(values: ReadonlyArray<number>): Map<number, number> {
    const order = values
        .map((value, index) => ({ value, index }))
        .filter((e) => Number.isFinite(e.value))
        .sort((a, b) => b.value - a.value);
    const ranks = new Map<number, number>();
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
        for (let k = i; k <= j; k++) ranks.set(order[k].index, i + 1);
        i = j + 1;
    }
    return ranks;
}

/** Compute aggregate over a numeric column. Only finite numbers are usable —
 *  nulls, non-numeric cells and ±Infinity / NaN are skipped, matching how
 *  `compile` reads quantitative columns, so every result stays finite. */
export function aggregate(values: ReadonlyArray<number | string | boolean | null>, kind: AggregateKind): number {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    switch (kind) {
        case "count":
            return nums.length;
        case "sum":
            return nums.reduce((a, b) => a + b, 0);
        case "mean":
            if (nums.length === 0) return 0;
            return nums.reduce((a, b) => a + b, 0) / nums.length;
        case "min":
            return nums.length === 0 ? 0 : Math.min(...nums);
        case "max":
            return nums.length === 0 ? 0 : Math.max(...nums);
        case "median": {
            if (nums.length === 0) return 0;
            const sorted = [...nums].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }
    }
}

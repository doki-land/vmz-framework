// Statistics — column aggregation for chart transforms.

export type AggregateKind = "count" | "sum" | "mean" | "min" | "max" | "median";

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

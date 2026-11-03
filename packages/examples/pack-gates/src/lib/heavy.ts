export function heavyCompute(seed: number): number {
    let total = 0;
    for (let index = 0; index < 10; index += 1) total += seed * (index + 1);
    return total;
}

export const HEAVY_MARKER = "HEAVY_LAZY_MARKER";

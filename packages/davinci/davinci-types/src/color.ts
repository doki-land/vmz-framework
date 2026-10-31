// Color primitives — RGBA canonical + conversions.

/** Canonical sRGB color with alpha (0–1 each). */
export interface RGBA {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

/** Construct from 0–255 integer channels. */
export function rgba8(r: number, g: number, b: number, a = 255): RGBA {
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: clamp01(a / 255) };
}

/** Construct opaque from 0–255 integer channels. */
export function rgb8(r: number, g: number, b: number): RGBA {
    return rgba8(r, g, b, 255);
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` hex strings. */
export function fromHex(hex: string): RGBA {
    const h = hex.trim().replace(/^#/, "");
    if (h.length === 3) {
        const r = parseInt(h[0] + h[0], 16);
        const g = parseInt(h[1] + h[1], 16);
        const b = parseInt(h[2] + h[2], 16);
        return rgba8(r, g, b);
    }
    if (h.length === 6) {
        return rgba8(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
    }
    if (h.length === 8) {
        return rgba8(
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
            parseInt(h.slice(6, 8), 16),
        );
    }
    throw new RangeError(`Invalid hex color: ${hex}`);
}

/** Serialize to `#rrggbb` (alpha 1) or `#rrggbbaa`. */
export function toHex(c: RGBA): string {
    const r = Math.round(c.r * 255).toString(16).padStart(2, "0");
    const g = Math.round(c.g * 255).toString(16).padStart(2, "0");
    const b = Math.round(c.b * 255).toString(16).padStart(2, "0");
    if (c.a >= 1) return `#${r}${g}${b}`;
    const a = Math.round(c.a * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`;
}

/** Opaque black. */
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
/** Opaque white. */
export const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };
/** Fully transparent. */
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function clamp01(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
}

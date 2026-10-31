// Bounding box primitives.

/** Axis-aligned rectangle (x, y is top-left, w/h non-negative). */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** Semantic alias — used by Scene packages for clarity. */
export type BoundsRect = Rect;

/** Rect from two corner points. */
export function rectFromPoints(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): Rect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Rect with explicit center and size. */
export function rectFromCenter(cx: number, cy: number, w: number, h: number): Rect {
    return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Union of two rects (minimal rect containing both). Empty rects are skipped. */
export function union(a: Rect, b: Rect): Rect {
    if (a.w <= 0 || a.h <= 0) return b;
    if (b.w <= 0 || b.h <= 0) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
    };
}

/** True if point (px, py) is inside rect. */
export function contains(r: Rect, px: number, py: number): boolean {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** True if two rects intersect (touching edges counts as intersecting). */
export function intersects(a: Rect, b: Rect): boolean {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** Apply a translate offset to a rect. */
export function offset(r: Rect, dx: number, dy: number): Rect {
    return { ...r, x: r.x + dx, y: r.y + dy };
}

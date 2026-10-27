// Geometry primitives — domain-agnostic shape foundations.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §3.

/** 2D point / vector (x, y). */
export interface Point2D {
    readonly x: number;
    readonly y: number;
}

/** 3D point / vector (x, y, z). */
export interface Point3D {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Affine 2D transform matrix (3x3, column-major compact form).
 *
 * ```text
 * | a c tx |
 * | b d ty |
 * | 0 0  1 |
 * ```
 *
 * Standard affine transforms (translate, scale, rotate, skew) compose via
 * {@link multiplyTransform}.
 */
export interface Affine2D {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
}

/** Identity affine (no-op). */
export const IDENTITY_AFFINE: Affine2D = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 0,
    ty: 0,
};

/** Compose two affine transforms: result = b ∘ a (apply a, then b). */
export function multiplyTransform(a: Affine2D, b: Affine2D): Affine2D {
    return {
        a: a.a * b.a + a.c * b.b,
        b: a.b * b.a + a.d * b.b,
        c: a.a * b.c + a.c * b.d,
        d: a.b * b.c + a.d * b.d,
        tx: a.a * b.tx + a.c * b.ty + a.tx,
        ty: a.b * b.tx + a.d * b.ty + a.ty,
    };
}

/** Translate by (dx, dy). */
export function translate(dx: number, dy: number): Affine2D {
    return { ...IDENTITY_AFFINE, tx: dx, ty: dy };
}

/** Scale by (sx, sy) around origin. */
export function scale(sx: number, sy: number): Affine2D {
    return { a: sx, d: sy, b: 0, c: 0, tx: 0, ty: 0 };
}

/** Rotate by radians around origin. */
export function rotate(angle: number): Affine2D {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

/** Apply affine transform to a point. */
export function applyTransform(p: Point2D, t: Affine2D): Point2D {
    return {
        x: t.a * p.x + t.c * p.y + t.tx,
        y: t.b * p.x + t.d * p.y + t.ty,
    };
}

/** A segment of a path — one of the SVG/Cubic-like command primitives. */
export type PathCommand =
    | { readonly kind: "move"; readonly to: Point2D }
    | { readonly kind: "line"; readonly to: Point2D }
    | {
          readonly kind: "cubic";
          readonly cp1: Point2D;
          readonly cp2: Point2D;
          readonly to: Point2D;
      }
    | {
          readonly kind: "quadratic";
          readonly cp: Point2D;
          readonly to: Point2D;
      }
    | { readonly kind: "arc"; readonly rx: number; readonly ry: number; readonly xRot: number; readonly largeArc: boolean; readonly sweep: boolean; readonly to: Point2D }
    | { readonly kind: "close" };

/** A simple path = sequence of commands, optionally closed. */
export interface Path {
    readonly commands: ReadonlyArray<PathCommand>;
}

export function moveTo(x: number, y: number): PathCommand {
    return { kind: "move", to: { x, y } };
}
export function lineTo(x: number, y: number): PathCommand {
    return { kind: "line", to: { x, y } };
}
export function closePath(): PathCommand {
    return { kind: "close" };
}

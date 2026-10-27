// Resolve — SemanticScene → DisplayScene.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §4.
//
// Resolve performs three things:
//   1. **Transform composition** — walk the tree, compose local affine with
//      parent affine to produce `worldTransform`.
//   2. **Clip inheritance** — intersect local clip with parent clip (if either
//      is present) to produce `worldClip`.
//   3. **Bounds calculation** — compute axis-aligned bounds in world space
//      for every node (used for hit test, culling, layout diagnostics).
//
// Renderers consume DisplayScene only. They must NOT reload data, recompute
// scales, infer layout, or execute domain compilation.

import {
    applyTransform,
    IDENTITY_AFFINE,
    multiplyTransform,
    type Affine2D,
    type BoundsRect,
    type Point2D,
    type RGBA,
} from "@vmz/davinci-types";
import type { DisplayNode, DisplayScene, DisplayGroup, DisplayStroke, DisplayFill } from "./display.js";
import type { SemanticNode, SemanticScene, Stroke, Fill } from "./semantic.js";

/** Resolve options — currently minimal; host extensions may add font metrics
 *  providers or resource loaders in future. */
export interface ResolveOptions {
    /** Logical canvas width for the root display scene. */
    width?: number;
    /** Logical canvas height for the root display scene. */
    height?: number;
}

const DEFAULT_STROKE: DisplayStroke = { color: { r: 0, g: 0, b: 0, a: 1 }, width: 1 };
const DEFAULT_FILL: DisplayFill = { color: { r: 0, g: 0, b: 0, a: 0 } };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };

function resolveStroke(s: Stroke | undefined): DisplayStroke | undefined {
    if (!s) return undefined;
    return {
        color: s.color ?? DEFAULT_STROKE.color,
        width: s.width ?? DEFAULT_STROKE.width,
        dash: s.dash,
    };
}

function resolveFill(f: Fill | undefined): DisplayFill | undefined {
    if (!f) return undefined;
    return { color: f.color ?? DEFAULT_FILL.color };
}

/** Resolve a SemanticScene into a DisplayScene.
 *
 *  The returned DisplayScene is fully resolved: every transform is composed,
 *  every clip is inherited, every bounds is final. Domain semantics (id,
 *  source ref, role) are intentionally stripped — use SemanticScene for
 *  provenance/debug/hit-test target lookup. */
export function resolve(scene: SemanticScene, opts: ResolveOptions = {}): DisplayScene {
    const root = resolveNode(scene.root, IDENTITY_AFFINE, undefined) as DisplayGroup;
    const width = opts.width ?? root.bounds.w;
    const height = opts.height ?? root.bounds.h;
    return { root, width, height };
}

function resolveNode(
    node: SemanticNode,
    parentTransform: Affine2D,
    parentClip: BoundsRect | undefined,
): DisplayNode {
    const local = node.transform ?? IDENTITY_AFFINE;
    const worldTransform = multiplyTransform(parentTransform, local);
    const worldClip = intersectClip(parentClip, node.clip);
    const base = { worldTransform, worldClip };

    switch (node.kind) {
        case "group": {
            const children = node.children.map((c) => resolveNode(c, worldTransform, worldClip));
            const bounds = unionAll(children.map((c) => c.bounds));
            return { kind: "group", children, bounds, ...base } as DisplayGroup;
        }
        case "path": {
            const bounds = transformRect(boundsOfPath(node.path.commands), worldTransform);
            return { kind: "path", path: node.path, stroke: resolveStroke(node.stroke), fill: resolveFill(node.fill), bounds, ...base };
        }
        case "rect": {
            const localRect: BoundsRect = { x: node.x, y: node.y, w: node.w, h: node.h };
            const bounds = transformRect(localRect, worldTransform);
            return { kind: "rect", x: node.x, y: node.y, w: node.w, h: node.h, rx: node.rx ?? 0, ry: node.ry ?? 0, stroke: resolveStroke(node.stroke), fill: resolveFill(node.fill), bounds, ...base };
        }
        case "ellipse": {
            const local: BoundsRect = { x: node.cx - node.rx, y: node.cy - node.ry, w: node.rx * 2, h: node.ry * 2 };
            const bounds = transformRect(local, worldTransform);
            return { kind: "ellipse", cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry, stroke: resolveStroke(node.stroke), fill: resolveFill(node.fill), bounds, ...base };
        }
        case "image": {
            const localRect: BoundsRect = { x: node.x, y: node.y, w: node.w, h: node.h };
            const bounds = transformRect(localRect, worldTransform);
            return { kind: "image", resourceRef: node.resourceRef, x: node.x, y: node.y, w: node.w, h: node.h, bounds, ...base };
        }
        case "text": {
            const anchor = node.anchor ?? { x: 0, y: 0 };
            // NOTE: text metrics require host-provided measurement — we keep
            // bounds as the anchor point for now. Future: integrate a metrics
            // provider interface.
            const bounds: BoundsRect = { x: anchor.x, y: anchor.y, w: 0, h: 0 };
            return { kind: "text", text: node.text, fontCss: "", anchor, color: node.color ?? BLACK, bounds, ...base };
        }
        case "marker": {
            // Markers expand into multiple identical DisplayNode copies —
            // resolve emits one group with children at each position.
            const children: DisplayNode[] = node.positions.map((p) => ({
                kind: "group",
                children: [],
                worldTransform: multiplyTransform(worldTransform, { ...IDENTITY_AFFINE, tx: p.x, ty: p.y }),
                worldClip,
                bounds: { x: p.x, y: p.y, w: 0, h: 0 },
            }));
            const bounds = unionAll(children.map((c) => c.bounds));
            return { kind: "group", children, bounds, ...base } as DisplayGroup;
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function intersectClip(a: BoundsRect | undefined, b: BoundsRect | undefined): BoundsRect | undefined {
    if (!a) return b;
    if (!b) return a;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    if (w <= 0 || h <= 0) return undefined;
    return { x, y, w, h };
}

function unionRect(a: BoundsRect, b: BoundsRect): BoundsRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
    };
}

function unionAll(rects: ReadonlyArray<BoundsRect>): BoundsRect {
    if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    return rects.slice(1).reduce((acc, b) => unionRect(acc, b), rects[0]);
}

/** Transform a bounding box through an affine (approximation via corners). */
function transformRect(r: BoundsRect, t: Affine2D): BoundsRect {
    const tl = applyTransform({ x: r.x, y: r.y }, t);
    const tr = applyTransform({ x: r.x + r.w, y: r.y }, t);
    const bl = applyTransform({ x: r.x, y: r.y + r.h }, t);
    const br = applyTransform({ x: r.x + r.w, y: r.y + r.h }, t);
    const xs = [tl.x, tr.x, bl.x, br.x];
    const ys = [tl.y, tr.y, bl.y, br.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Compute bounds of a path by taking extrema of endpoints and control points. */
function boundsOfPath(commands: ReadonlyArray<{ readonly kind: string } & Record<string, unknown>>): BoundsRect {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const add = (p: Point2D) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    };

    for (const cmd of commands) {
        switch (cmd.kind) {
            case "move":
            case "line":
                add(cmd.to as Point2D);
                break;
            case "cubic":
                add(cmd.cp1 as Point2D);
                add(cmd.cp2 as Point2D);
                add(cmd.to as Point2D);
                break;
            case "quadratic":
                add(cmd.cp as Point2D);
                add(cmd.to as Point2D);
                break;
            case "arc":
                add(cmd.to as Point2D);
                break;
            case "close":
                break;
        }
    }

    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

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
    type FontSpec,
    type Point2D,
    type RGBA,
} from "@doki-land/davinci-types";
import type { DisplayNode, DisplayScene, DisplayGroup, DisplayStroke, DisplayFill } from "./display.js";
import type { SemanticNode, SemanticScene, Stroke, Fill } from "./semantic.js";
import { assertSceneVersion, SCENE_VERSION } from "./version.js";

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

// ─── Text metrics (deterministic estimate, no host measurement) ──────────

/** Half-width glyph advance as a fraction of font size. */
const TEXT_ADVANCE_RATIO = 0.6;
/** Wide (East-Asian fullwidth) glyph advance as a fraction of font size. */
const WIDE_ADVANCE_RATIO = 1;
/** Line box height as a fraction of font size. */
const TEXT_LINE_RATIO = 1.2;
const DEFAULT_TEXT_SIZE = 12;
const ELLIPSIS = "…";

/** Estimate a text block's size without a font measurement provider.
 *  This is a deterministic approximation that marks the current limitation,
 *  not real metrics: browser font metrics are only available after
 *  `document.fonts.ready`, so a host needing tight bounds must re-measure
 *  there instead of trusting these numbers.
 *  Width = widest line's summed glyph advances (wide CJK glyphs 1 em,
 *  half-width glyphs 0.6 em), height = line count × size × 1.2. */
export function estimateTextSize(text: string, sizePx: number): { width: number; height: number } {
    const size = Number.isFinite(sizePx) && sizePx > 0 ? sizePx : DEFAULT_TEXT_SIZE;
    const lines = text.split("\n");
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, measureWidth(line, size));
    return { width: widest, height: lines.length * size * TEXT_LINE_RATIO };
}

/** Truncate `text` so its estimated width fits `maxWidth`, appending `…` when
 *  characters were dropped. The longest prefix that still fits is kept; when
 *  even the ellipsis does not fit, the result is empty. Truncation and bounds
 *  share one advance model, so they can never disagree. */
export function truncateToWidth(text: string, maxWidth: number, sizePx: number): string {
    const size = Number.isFinite(sizePx) && sizePx > 0 ? sizePx : DEFAULT_TEXT_SIZE;
    // `Infinity` means "no budget" (numeric axes are bounded by the tick
    // algorithm); NaN and non-positive widths collapse to an empty label.
    const limit = maxWidth > 0 ? maxWidth : 0;
    if (measureWidth(text, size) <= limit) return text;
    const ellipsisWidth = measureWidth(ELLIPSIS, size);
    if (ellipsisWidth > limit) return "";
    const chars = Array.from(text);
    let used = ellipsisWidth;
    let keep = 0;
    for (const ch of chars) {
        const advance = charAdvance(ch, size);
        if (used + advance > limit) break;
        used += advance;
        keep += 1;
    }
    return chars.slice(0, keep).join("") + ELLIPSIS;
}

function measureWidth(text: string, size: number): number {
    let width = 0;
    for (const ch of Array.from(text)) width += charAdvance(ch, size);
    return width;
}

function charAdvance(ch: string, size: number): number {
    return isWideCodepoint(ch.codePointAt(0) ?? 0) ? size * WIDE_ADVANCE_RATIO : size * TEXT_ADVANCE_RATIO;
}

/** East-Asian fullwidth ranges the deterministic model advances as one em.
 *  This is a bounded model, not a full Unicode EastAsianWidth table. */
function isWideCodepoint(cp: number): boolean {
    return (
        (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0x303e) || // radicals, Kangxi, CJK symbols and punctuation
        (cp >= 0x3041 && cp <= 0x33ff) || // kana, Hangul compatibility, enclosed CJK
        (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
        (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
        (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
        (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
        (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Form Variants
        (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
        (cp >= 0xffe0 && cp <= 0xffe6) // fullwidth signs
    );
}

function fontCssOf(font: FontSpec): string {
    const size = Number.isFinite(font.sizePx) && font.sizePx > 0 ? font.sizePx : DEFAULT_TEXT_SIZE;
    const family = font.family || "sans-serif";
    const style = font.italic ? "italic " : "";
    const weight = font.weight ?? 400;
    return `${style}${weight} ${size}px ${family.includes(" ") ? `"${family}"` : family}`;
}

/** Resolve a SemanticScene into a DisplayScene.
 *
 *  The returned DisplayScene is fully resolved: every transform is composed,
 *  every clip is inherited, every bounds is final. Domain semantics (id,
 *  source ref, role) are intentionally stripped — use SemanticScene for
 *  provenance/debug/hit-test target lookup. */
export function resolve(scene: SemanticScene, opts: ResolveOptions = {}): DisplayScene {
    assertSceneVersion(scene.version, "resolve");
    const root = resolveNode(scene.root, IDENTITY_AFFINE, undefined) as DisplayGroup;
    const width = opts.width ?? root.bounds.w;
    const height = opts.height ?? root.bounds.h;
    return { version: SCENE_VERSION, root, width, height };
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
            // The anchor is the centre of the text block, so bounds come from
            // a deterministic estimate (no host font metrics are involved).
            const size = estimateTextSize(node.text, node.font.sizePx);
            const localRect: BoundsRect = {
                x: anchor.x - size.width / 2,
                y: anchor.y - size.height / 2,
                w: size.width,
                h: size.height,
            };
            const bounds = transformRect(localRect, worldTransform);
            return {
                kind: "text",
                text: node.text,
                fontCss: fontCssOf(node.font),
                anchor,
                color: node.color ?? BLACK,
                bounds,
                ...base,
            };
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

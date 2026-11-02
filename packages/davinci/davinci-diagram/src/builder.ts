// Diagram scene builder — DiagramLayoutPlan → SemanticScene.
//
// Visual contract: edges are clipped to node boundaries (never run under the
// node body), `arrow` / `bidirectional` edges carry real arrowheads, edge
// labels sit on a halo so the routed line never strikes through the text,
// and node labels truncate into their box instead of overflowing it.

import type { BoundsRect, PathCommand, Point2D } from "@doki-land/davinci-types";
import {
    SCENE_VERSION,
    estimateTextSize,
    truncateToWidth,
    type SemanticNode,
    type SemanticScene,
} from "@doki-land/davinci-scene";
import type { DiagramLayoutPlan } from "./layout.js";
import type { DiagramEdgeSpec, DiagramSpec } from "./spec.js";
import { DEFAULT_DIAGRAM_THEME, type DiagramTheme } from "./theme.js";

/** Options for the diagram scene build. */
export interface DiagramSceneOptions {
    /** Presentation tokens; defaults to `DEFAULT_DIAGRAM_THEME`. */
    readonly theme?: DiagramTheme;
}

const ARROW_LENGTH = 10;
const ARROW_WIDTH = 8;
const NODE_LABEL_PADDING = 12;
const EDGE_LABEL_PAD_X = 4;
const EDGE_LABEL_PAD_Y = 2;

/** Build a SemanticScene from a DiagramSpec + DiagramLayoutPlan. */
export function buildScene(spec: DiagramSpec, plan: DiagramLayoutPlan, options?: DiagramSceneOptions): SemanticScene {
    const theme = options?.theme ?? DEFAULT_DIAGRAM_THEME;
    const children: SemanticNode[] = [];
    const nodeBounds = new Map(plan.nodes.map((n) => [n.id, n.bounds]));

    // Edges first — node bodies paint above the clipped segment ends.
    for (const e of plan.edges) {
        const specEdge = spec.edges.find((s) => s.id === e.id);
        const fromBounds = nodeBounds.get(specEdge?.fromNode ?? "");
        const toBounds = nodeBounds.get(specEdge?.toNode ?? "");
        const clippedFrom = fromBounds ? clipToRect(e.from, e.to, fromBounds) : e.from;
        const clippedTo = toBounds ? clipToRect(e.to, e.from, toBounds) : e.to;

        const pathCmds: PathCommand[] = [
            { kind: "move", to: clippedFrom },
            ...e.route.map((p): PathCommand => ({ kind: "line", to: p })),
            { kind: "line", to: clippedTo },
        ];
        const stroke = edgeStroke(specEdge, theme);
        children.push({
            kind: "path",
            id: `edge-${e.id}`,
            role: "diagram.edge",
            source: { domain: "diagram", path: ["edge", e.id] },
            path: { commands: pathCmds },
            stroke,
        });

        // Arrowheads are real filled triangles derived from the final segment
        // direction — no SVG marker defs, so SSR and static export share the
        // exact same geometry.
        const arrowKind = specEdge?.edgeKind;
        if (arrowKind === "arrow" || arrowKind === "bidirectional") {
            children.push(arrowhead(`edge-arrow-to-${e.id}`, e.id, clippedTo, direction(clippedFrom, clippedTo), stroke.color));
        }
        if (arrowKind === "bidirectional") {
            children.push(arrowhead(`edge-arrow-from-${e.id}`, e.id, clippedFrom, direction(clippedTo, clippedFrom), stroke.color));
        }

        if (specEdge?.label) {
            children.push(...edgeLabel(specEdge, clippedFrom, clippedTo, theme));
        }
    }

    // Nodes: rounded rect + label truncated into the box.
    for (const n of plan.nodes) {
        const specNode = spec.nodes.find((s) => s.id === n.id);
        children.push({
            kind: "rect",
            id: `node-${n.id}`,
            role: "diagram.node",
            source: { domain: "diagram", path: ["node", n.id] },
            x: n.bounds.x,
            y: n.bounds.y,
            w: n.bounds.w,
            h: n.bounds.h,
            rx: theme.nodeRadius,
            ry: theme.nodeRadius,
            fill: { color: theme.nodeFill },
            stroke: { color: theme.nodeStroke, width: theme.nodeStrokeWidth },
        });
        if (specNode?.label) {
            children.push({
                kind: "text",
                id: `node-label-${n.id}`,
                role: "text",
                source: { domain: "diagram", path: ["node", n.id, "label"] },
                text: truncateToWidth(
                    specNode.label,
                    Math.max(0, n.bounds.w - NODE_LABEL_PADDING),
                    theme.nodeLabelFont.sizePx,
                ),
                font: theme.nodeLabelFont,
                anchor: { x: n.bounds.x + n.bounds.w / 2, y: n.bounds.y + n.bounds.h / 2 },
                color: theme.nodeLabelColor,
            });
        }
    }

    return {
        version: SCENE_VERSION,
        root: {
            kind: "group",
            id: "diagram-root",
            role: "group",
            children: children as ReadonlyArray<SemanticNode>,
        },
    };
}

function edgeStroke(specEdge: DiagramEdgeSpec | undefined, theme: DiagramTheme): { color: typeof theme.edgeStroke; width: number; dash?: ReadonlyArray<number> } {
    const base = { color: theme.edgeStroke, width: theme.edgeStrokeWidth };
    switch (specEdge?.edgeKind) {
        case "dashed":
            return { ...base, dash: [6, 4] };
        case "dotted":
            return { ...base, dash: [2, 3] };
        case "thick":
            return { ...base, width: theme.edgeStrokeWidth * 1.8 };
        default:
            return base;
    }
}

/** Edge label = halo rect + text at the clipped segment midpoint. The halo
 *  is emitted right before the text so paint order keeps the glyph clear of
 *  the routed line. */
function edgeLabel(
    specEdge: DiagramEdgeSpec,
    from: Point2D,
    to: Point2D,
    theme: DiagramTheme,
): SemanticNode[] {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const size = estimateTextSize(specEdge.label!, theme.edgeLabelFont.sizePx);
    return [
        {
            kind: "rect",
            id: `edge-label-halo-${specEdge.id}`,
            role: "decorative",
            source: { domain: "diagram", path: ["edge", specEdge.id, "label"] },
            x: mid.x - size.width / 2 - EDGE_LABEL_PAD_X,
            y: mid.y - size.height / 2 - EDGE_LABEL_PAD_Y,
            w: size.width + EDGE_LABEL_PAD_X * 2,
            h: size.height + EDGE_LABEL_PAD_Y * 2,
            rx: 2,
            ry: 2,
            fill: { color: theme.labelHalo },
        },
        {
            kind: "text",
            id: `edge-label-${specEdge.id}`,
            role: "diagram.label",
            source: { domain: "diagram", path: ["edge", specEdge.id, "label"] },
            text: specEdge.label!,
            font: theme.edgeLabelFont,
            anchor: mid,
            color: theme.edgeLabelColor,
        },
    ];
}

/** Filled triangle arrowhead at `tip`, pointing along `dir`. */
function arrowhead(id: string, edgeId: string, tip: Point2D, dir: Point2D, color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): SemanticNode {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    const px = -uy;
    const py = ux;
    const baseX = tip.x - ux * ARROW_LENGTH;
    const baseY = tip.y - uy * ARROW_LENGTH;
    const half = ARROW_WIDTH / 2;
    return {
        kind: "path",
        id,
        role: "diagram.edge",
        source: { domain: "diagram", path: ["edge", edgeId, "arrowhead"] },
        path: {
            commands: [
                { kind: "move", to: tip },
                { kind: "line", to: { x: baseX + px * half, y: baseY + py * half } },
                { kind: "line", to: { x: baseX - px * half, y: baseY - py * half } },
                { kind: "close" },
            ],
        },
        fill: { color },
        stroke: { color, width: 1 },
    };
}

function direction(from: Point2D, to: Point2D): Point2D {
    return { x: to.x - from.x, y: to.y - from.y };
}

/** Clip the segment `center → other` to the boundary of `rect`: returns the
 *  point where the segment leaves the node body, so edges attach to the
 *  border instead of running underneath it. Falls back to the center when
 *  the segment degenerates. */
function clipToRect(center: Point2D, other: Point2D, rect: BoundsRect): Point2D {
    const dx = other.x - center.x;
    const dy = other.y - center.y;
    if (dx === 0 && dy === 0) return center;
    const candidates: number[] = [];
    if (dx !== 0) {
        candidates.push(((rect.x - center.x) / dx), ((rect.x + rect.w - center.x) / dx));
    }
    if (dy !== 0) {
        candidates.push(((rect.y - center.y) / dy), ((rect.y + rect.h - center.y) / dy));
    }
    // The exit point is the smallest positive parameter whose point lies on
    // the rect boundary (all larger ones exit through the far side or enter
    // through the near side).
    let best = Number.POSITIVE_INFINITY;
    for (const t of candidates) {
        if (t <= 0) continue;
        const x = center.x + t * dx;
        const y = center.y + t * dy;
        const onX = Math.abs(x - rect.x) < 1e-9 || Math.abs(x - (rect.x + rect.w)) < 1e-9;
        const onY = Math.abs(y - rect.y) < 1e-9 || Math.abs(y - (rect.y + rect.h)) < 1e-9;
        const insideX = x >= rect.x - 1e-9 && x <= rect.x + rect.w + 1e-9;
        const insideY = y >= rect.y - 1e-9 && y <= rect.y + rect.h + 1e-9;
        if ((onX && insideY) || (onY && insideX)) best = Math.min(best, t);
    }
    if (!Number.isFinite(best)) return center;
    return { x: center.x + best * dx, y: center.y + best * dy };
}

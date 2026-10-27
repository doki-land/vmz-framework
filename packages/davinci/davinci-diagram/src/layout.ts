// Diagram layout — computes node positions, layers, port anchors, edge routes.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §5.
//
// DiagramLayoutPlan is the bridge between DiagramSpec (domain topology) and
// SemanticScene (shape tree). This module emits a structured plan that the
// scene builder consumes. Full graph layout (layered Sugiyama for flowcharts,
// force-directed for custom graphs) is future work.

import type { BoundsRect, DiagnosticSet } from "@doki-land/davinci-types";
import type { DiagramEdgeSpec, DiagramNodeSpec, DiagramSpec } from "./spec.js";

/** A placed node from layout. */
export interface LayoutedNode {
    readonly id: string;
    /** Final bounds (after layout). */
    readonly bounds: BoundsRect;
    /** Optional layer index (layered layouts only). */
    readonly layer?: number;
    /** Optional column index within layer. */
    readonly column?: number;
    /** Optional port anchor points on node boundary. */
    readonly portAnchors?: ReadonlyMap<string, { x: number; y: number }>;
}

/** A routed edge from layout — not a raw SVG path; just the control points. */
export interface RoutedEdge {
    readonly id: string;
    readonly from: { x: number; y: number };
    readonly to: { x: number; y: number };
    /** Optional intermediate control points (for orthogonal or bezier routes). */
    readonly route: ReadonlyArray<{ x: number; y: number }>;
}

/** Full layout plan — scene builder consumes this. */
export interface DiagramLayoutPlan {
    readonly nodes: ReadonlyArray<LayoutedNode>;
    readonly edges: ReadonlyArray<RoutedEdge>;
    readonly clusters: ReadonlyArray<{ id: string; bounds: BoundsRect }>;
    /** Overall canvas bounds. */
    readonly canvasBounds: BoundsRect;
    readonly diagnostics: DiagnosticSet;
}

// ─── Simple layout helpers (layered for flowchart) ──────────────────────

const DEFAULT_NODE_W = 120;
const DEFAULT_NODE_H = 50;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 40;

/** Compute a simple left-to-right layered layout for flowcharts.
 *  Places nodes by topological order and ranks edges backward.
 *  Not optimal — produces a workable plan for basic graphs. */
export function simpleLayout(spec: DiagramSpec): DiagramLayoutPlan {
    const nodes = new Map<string, DiagramNodeSpec>();
    for (const n of spec.nodes) nodes.set(n.id, n);

    // Find roots (nodes with no incoming edges).
    const incoming = new Map<string, number>();
    for (const n of spec.nodes) incoming.set(n.id, 0);
    for (const e of spec.edges) incoming.set(e.toNode, (incoming.get(e.toNode) ?? 0) + 1);

    const layers: string[][] = [];
    const placed = new Set<string>();
    const queue: string[] = [];

    for (const [id, count] of incoming) {
        if (count === 0) queue.push(id);
    }

    while (queue.length > 0) {
        const layer: string[] = [];
        const nextQueue: string[] = [];
        for (const id of queue) {
            if (placed.has(id)) continue;
            placed.add(id);
            layer.push(id);
            for (const e of spec.edges) {
                if (e.fromNode === id && !placed.has(e.toNode)) {
                    nextQueue.push(e.toNode);
                }
            }
        }
        if (layer.length > 0) layers.push(layer);
        queue.push(...nextQueue);
    }

    // Place unplaced nodes in a final layer.
    const leftovers: string[] = [];
    for (const n of spec.nodes) if (!placed.has(n.id)) leftovers.push(n.id);
    if (leftovers.length > 0) layers.push(leftovers);

    // Compute positions.
    const layoutedNodes: LayoutedNode[] = [];
    let maxRight = 0;
    let maxBottom = 0;
    for (let li = 0; li < layers.length; li++) {
        const layerNodes = layers[li];
        const x = li * (DEFAULT_NODE_W + NODE_GAP_X);
        for (let ci = 0; ci < layerNodes.length; ci++) {
            const nid = layerNodes[ci];
            const node = nodes.get(nid)!;
            const w = node.sizeHint?.w ?? DEFAULT_NODE_W;
            const h = node.sizeHint?.h ?? DEFAULT_NODE_H;
            const y = ci * (h + NODE_GAP_Y);
            layoutedNodes.push({
                id: nid,
                bounds: { x, y, w, h },
                layer: li,
                column: ci,
            });
            maxRight = Math.max(maxRight, x + w);
            maxBottom = Math.max(maxBottom, y + h);
        }
    }

    // Route edges as straight lines from node center to node center.
    const nodeCenter = new Map<string, { x: number; y: number }>();
    for (const ln of layoutedNodes) {
        nodeCenter.set(ln.id, { x: ln.bounds.x + ln.bounds.w / 2, y: ln.bounds.y + ln.bounds.h / 2 });
    }
    const routedEdges: RoutedEdge[] = [];
    for (const e of spec.edges) {
        const from = nodeCenter.get(e.fromNode);
        const to = nodeCenter.get(e.toNode);
        if (!from || !to) continue;
        routedEdges.push({ id: e.id, from, to, route: [] });
    }

    const canvasBounds: BoundsRect = { x: 0, y: 0, w: maxRight + NODE_GAP_X, h: maxBottom + NODE_GAP_Y };

    return {
        nodes: layoutedNodes as ReadonlyArray<LayoutedNode>,
        edges: routedEdges as ReadonlyArray<RoutedEdge>,
        clusters: [],
        canvasBounds,
        diagnostics: { items: [] },
    };
}

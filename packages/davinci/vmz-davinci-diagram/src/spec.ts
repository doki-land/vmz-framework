// Diagram spec — graph topology, nodes, edges, ports, clusters, constraints.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §5.
//
// DiagramSpec is the domain input to davinci-diagram. It does NOT carry
// SVG path, paint order, or canvas commands — the layout engine computes
// node positions, layer assignments, port anchors, edge routes, and label
// placements.

import type { BoundsRect } from "@vmz/davinci-types";

/** Diagram kind hints the layout engine. */
export type DiagramKind = "flowchart" | "sequence" | "class" | "graph" | "custom";

/** Direction hint for flowchart layouts. */
export type FlowDirection = "LR" | "RL" | "TB" | "BT";

/** Port anchor on a node — edge attaches here. */
export interface PortSpec {
    readonly id: string;
    /** Side of the node (approximate; layout may adjust). */
    readonly side: "top" | "bottom" | "left" | "right";
    /** Optional label text. */
    readonly label?: string;
    /** Offset from center in pixels (layout-adjusted during resolve). */
    readonly offsetX?: number;
    readonly offsetY?: number;
}

/** A node in the diagram graph. */
export interface DiagramNodeSpec {
    readonly id: string;
    /** Text shown inside the node. */
    readonly label?: string;
    /** Optional initial size hint (in layout units). Overridden by layout. */
    readonly sizeHint?: { w: number; h: number };
    /** Optional initial position hint (absolute coords). Layout may ignore. */
    readonly positionHint?: { x: number; y: number };
    /** Side-specific ports. */
    readonly ports?: ReadonlyArray<PortSpec>;
    /** Sub-type hint (shape/style for flowchart nodes like diamond, rounded). */
    readonly nodeKind?: "rect" | "diamond" | "circle" | "ellipse" | "hexagon" | "subgraph" | "custom";
}

/** An edge connects two ports (or node centers if ports absent). */
export interface DiagramEdgeSpec {
    readonly id: string;
    readonly fromNode: string;
    readonly fromPort?: string;
    readonly toNode: string;
    readonly toPort?: string;
    /** Edge label text (optional). */
    readonly label?: string;
    /** Style hint: "solid" | "dashed" | "dotted" | "thick" | "arrow" | "bidirectional" | "no-arrow". */
    readonly edgeKind?: "solid" | "dashed" | "dotted" | "thick" | "arrow" | "bidirectional" | "no-arrow";
}

/** A cluster groups nodes for visual enclosure (e.g., flowchart subgraph). */
export interface DiagramClusterSpec {
    readonly id: string;
    readonly label?: string;
    readonly nodeIds: ReadonlyArray<string>;
}

/** A layout constraint (soft hint — layout engine may ignore). */
export type DiagramConstraint =
    | { readonly kind: "ordering"; readonly before: string; readonly after: string }
    | { readonly kind: "same-layer"; readonly nodeIds: ReadonlyArray<string> }
    | { readonly kind: "separation"; readonly nodeA: string; readonly nodeB: string; readonly minGap: number };

/** Full diagram domain input. */
export interface DiagramSpec {
    readonly kind: DiagramKind;
    readonly direction?: FlowDirection;
    readonly nodes: ReadonlyArray<DiagramNodeSpec>;
    readonly edges: ReadonlyArray<DiagramEdgeSpec>;
    readonly clusters?: ReadonlyArray<DiagramClusterSpec>;
    readonly constraints?: ReadonlyArray<DiagramConstraint>;
}

/** Compute bounds of a DiagramSpec based on position hints and size hints.
 *  Returns empty rect if no hints are present (caller should use layout output). */
export function specBounds(spec: DiagramSpec): BoundsRect {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of spec.nodes) {
        if (n.positionHint) {
            const w = n.sizeHint?.w ?? 100;
            const h = n.sizeHint?.h ?? 40;
            minX = Math.min(minX, n.positionHint.x);
            minY = Math.min(minY, n.positionHint.y);
            maxX = Math.max(maxX, n.positionHint.x + w);
            maxY = Math.max(maxY, n.positionHint.y + h);
        }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

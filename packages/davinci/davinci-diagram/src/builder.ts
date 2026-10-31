// Diagram scene builder — DiagramLayoutPlan → SemanticScene.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §5.

import { BLACK, TRANSPARENT, WHITE, type PathCommand, type RGBA } from "@doki-land/davinci-types";
import { SCENE_VERSION, type SemanticGroup, type SemanticNode, type SemanticScene } from "@doki-land/davinci-scene";
import type { DiagramLayoutPlan } from "./layout.js";
import type { DiagramSpec } from "./spec.js";

const NODE_FILL: RGBA = { ...WHITE };
const NODE_STROKE = { color: BLACK, width: 1 };
const EDGE_STROKE = { color: BLACK, width: 1 };
const LABEL_COLOR = BLACK;
const DEFAULT_NODE_LABEL_FONT = { family: "sans-serif", sizePx: 14 };
const DEFAULT_EDGE_LABEL_FONT = { family: "sans-serif", sizePx: 12 };

/** Build a SemanticScene from a DiagramSpec + DiagramLayoutPlan. */
export function buildScene(spec: DiagramSpec, plan: DiagramLayoutPlan): SemanticScene {
    const children: SemanticNode[] = [];

    // Nodes as rectangles with optional text.
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
            fill: { color: NODE_FILL },
            stroke: NODE_STROKE,
        });
        if (specNode?.label) {
            children.push({
                kind: "text",
                id: `node-label-${n.id}`,
                role: "text",
                source: { domain: "diagram", path: ["node", n.id, "label"] },
                text: specNode.label,
                font: DEFAULT_NODE_LABEL_FONT,
                anchor: { x: n.bounds.x + n.bounds.w / 2, y: n.bounds.y + n.bounds.h / 2 },
                color: LABEL_COLOR,
            });
        }
    }

    // Edges as paths (straight lines from center to center + optional labels).
    for (const e of plan.edges) {
        const pathCmds: PathCommand[] = [
            { kind: "move", to: e.from },
            ...e.route.map((p): PathCommand => ({ kind: "line", to: p })),
            { kind: "line", to: e.to },
        ];
        children.push({
            kind: "path",
            id: `edge-${e.id}`,
            role: "diagram.edge",
            source: { domain: "diagram", path: ["edge", e.id] },
            path: { commands: pathCmds },
            stroke: EDGE_STROKE,
        });
        const specEdge = spec.edges.find((s) => s.id === e.id);
        if (specEdge?.label) {
            children.push({
                kind: "text",
                id: `edge-label-${e.id}`,
                role: "diagram.label",
                source: { domain: "diagram", path: ["edge", e.id, "label"] },
                text: specEdge.label,
                font: DEFAULT_EDGE_LABEL_FONT,
                anchor: { x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2 },
                color: LABEL_COLOR,
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

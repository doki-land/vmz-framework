// DaVinci engine facade — single public entry.
// Tree-shakeable ESM; sideEffects: false.

// Types, scene, runtime, motion — no name collisions.
export * from "@doki-land/davinci-types";
export * from "@doki-land/davinci-scene";
export * from "@doki-land/davinci-runtime";
export * from "@doki-land/davinci-motion";

// Chart exports buildScene(ChartCompilePlan, ChartViewport → SemanticScene).
// This is kept under the canonical name `buildScene` in the aggregate.
export * from "@doki-land/davinci-chart";

// Diagram also exports buildScene(DiagramSpec, DiagramLayoutPlan → SemanticScene),
// which collides with the chart one. Re-export everything else explicitly and
// alias the diagram variant to `buildDiagramScene`.
export type {
    DiagramConstraint,
    DiagramEdgeSpec,
    DiagramKind,
    DiagramLayoutPlan,
    DiagramNodeSpec,
    DiagramSpec,
    DiagramClusterSpec,
    FlowDirection,
    LayoutedNode,
    MermaidBlock,
    PortSpec,
    RoutedEdge,
} from "@doki-land/davinci-diagram";
export {
    fromSpec,
    parseMermaid,
    simpleLayout,
    specBounds,
    buildScene as buildDiagramScene,
} from "@doki-land/davinci-diagram";

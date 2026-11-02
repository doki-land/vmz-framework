// Diagram theme — presentation tokens resolved before the scene builder.
// Mirrors the chart theme contract: the builder resolves every color and
// font, the renderer never picks one.

import { rgb8, type FontSpec, type RGBA } from "@doki-land/davinci-types";

/** Presentation tokens the diagram scene builder consumes. */
export interface DiagramTheme {
    /** Node body fill. */
    readonly nodeFill: RGBA;
    /** Node outline. */
    readonly nodeStroke: RGBA;
    readonly nodeStrokeWidth: number;
    /** Node corner radius in px. */
    readonly nodeRadius: number;
    /** Node label color and font. */
    readonly nodeLabelColor: RGBA;
    readonly nodeLabelFont: FontSpec;
    /** Edge stroke. */
    readonly edgeStroke: RGBA;
    readonly edgeStrokeWidth: number;
    /** Edge label color and font. */
    readonly edgeLabelColor: RGBA;
    readonly edgeLabelFont: FontSpec;
    /** Halo painted behind edge labels so the routed line never strikes
     *  through the text. */
    readonly labelHalo: RGBA;
}

const LABEL_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/** Reference light theme. */
export const DEFAULT_DIAGRAM_THEME: DiagramTheme = {
    nodeFill: rgb8(248, 250, 252),
    nodeStroke: rgb8(100, 116, 139),
    nodeStrokeWidth: 1.25,
    nodeRadius: 6,
    nodeLabelColor: rgb8(30, 41, 59),
    nodeLabelFont: { family: LABEL_FAMILY, sizePx: 13 },
    edgeStroke: rgb8(100, 116, 139),
    edgeStrokeWidth: 1.5,
    edgeLabelColor: rgb8(71, 85, 105),
    edgeLabelFont: { family: LABEL_FAMILY, sizePx: 12 },
    labelHalo: rgb8(255, 255, 255),
};

/** Dark theme — quiet chrome, lifted label contrast. */
export const DARK_DIAGRAM_THEME: DiagramTheme = {
    nodeFill: rgb8(31, 41, 55),
    nodeStroke: rgb8(107, 114, 128),
    nodeStrokeWidth: 1.25,
    nodeRadius: 6,
    nodeLabelColor: rgb8(229, 231, 235),
    nodeLabelFont: { family: LABEL_FAMILY, sizePx: 13 },
    edgeStroke: rgb8(156, 163, 175),
    edgeStrokeWidth: 1.5,
    edgeLabelColor: rgb8(209, 213, 219),
    edgeLabelFont: { family: LABEL_FAMILY, sizePx: 12 },
    labelHalo: rgb8(17, 24, 39),
};

// Text primitives — measured text block.

/** A font family + size + weight/style descriptor (platform-neutral). */
export interface FontSpec {
    readonly family: string;
    readonly sizePx: number;
    readonly weight?: number;
    readonly italic?: boolean;
}

/** Measured text metrics from a text layout engine (platform-provided). */
export interface TextMetrics {
    /** Line box width in CSS pixels. */
    readonly width: number;
    /** Line box height (includes line-gap). */
    readonly height: number;
    /** Distance from baseline to top of em-square. */
    readonly ascent: number;
    /** Distance from baseline to bottom of em-square. */
    readonly descent: number;
    /** Line gap between lines. */
    readonly lineGap: number;
}

/** A text node content — display text + font + alignment. */
export interface TextRun {
    readonly text: string;
    readonly font: FontSpec;
    /** Horizontal anchor on the anchor point. Default "start". */
    readonly hAlign?: "start" | "center" | "end";
    /** Vertical anchor on the anchor point. Default "alphabetic". */
    readonly vAlign?: "alphabetic" | "top" | "middle" | "bottom";
}

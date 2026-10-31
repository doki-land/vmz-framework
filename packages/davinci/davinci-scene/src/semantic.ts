// SemanticScene — retains domain identity, semantic ids, source refs.
//
// Semantic nodes carry only "what this IS"; they intentionally do NOT carry
// resolved transform, clip inheritance, or backend-ready geometry. Those live
// in DisplayScene after `resolve()` runs.

import type { Affine2D, Path, Point2D, RGBA, Rect as BoundsRect } from "@doki-land/davinci-types";
import type { SceneVersion } from "./version.js";

/** A stable identifier assigned by the domain (chart, diagram, ...). */
export type StableId = string;

/** High-level semantic role — used for hit-test targets and host binding. */
export type SemanticRole =
    | "chart.mark"
    | "chart.axis"
    | "chart.legend"
    | "diagram.node"
    | "diagram.edge"
    | "diagram.label"
    | "diagram.cluster"
    | "diagram.port"
    | "text"
    | "image"
    | "decorative"
    | "group";

/** Source reference — back-link to the domain object that produced this node.
 *  Opaque to Scene; used by host for provenance / edit / export links. */
export interface SourceRef {
    /** Domain identifier ("chart", "diagram", ...). */
    readonly domain: string;
    /** Optional path within the domain (field name, row index, node id, ...). */
    readonly path?: ReadonlyArray<string | number>;
}

/** Hit region — optional explicit rect for hit-testing (overrides geometry bounds). */
export interface HitRegion {
    readonly rect: BoundsRect;
}

// ─── Shape kinds ──────────────────────────────────────────────────────────

export interface BaseSemantic {
    /** Stable identity — MUST be unique within one Scene. */
    readonly id: StableId;
    /** What this node IS (semantic tag, not style). */
    readonly role: SemanticRole;
    /** Optional back-link to domain source. */
    readonly source?: SourceRef;
    /** Optional hit region override. */
    readonly hitRegion?: HitRegion;
}

export interface SemanticTransform {
    /** Local transform (will be composed with parent during resolve). */
    readonly transform?: Affine2D;
    /** Optional local clip rect (intersected with parent clip during resolve). */
    readonly clip?: BoundsRect;
}

export interface Stroke {
    readonly color?: RGBA;
    readonly width?: number;
    readonly dash?: ReadonlyArray<number>;
}

export interface Fill {
    readonly color?: RGBA;
}

/** A group node — container only; carries transform/clip and children. */
export interface SemanticGroup extends BaseSemantic, SemanticTransform {
    readonly kind: "group";
    readonly children: ReadonlyArray<SemanticNode>;
}

/** A path shape (SVG/Cubic-style command sequence). */
export interface SemanticPath extends BaseSemantic, SemanticTransform {
    readonly kind: "path";
    readonly path: Path;
    readonly stroke?: Stroke;
    readonly fill?: Fill;
}

/** An axis-aligned rectangle. */
export interface SemanticRect extends BaseSemantic, SemanticTransform {
    readonly kind: "rect";
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly rx?: number;
    readonly ry?: number;
    readonly stroke?: Stroke;
    readonly fill?: Fill;
}

/** An ellipse defined by center + radii. */
export interface SemanticEllipse extends BaseSemantic, SemanticTransform {
    readonly kind: "ellipse";
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
    readonly stroke?: Stroke;
    readonly fill?: Fill;
}

/** An image — referenced by URL / resource id; NOT raw pixels. */
export interface SemanticImage extends BaseSemantic, SemanticTransform {
    readonly kind: "image";
    readonly resourceRef: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** A text node — string + font spec. Host provides actual metrics. */
export interface SemanticText extends BaseSemantic, SemanticTransform {
    readonly kind: "text";
    readonly text: string;
    readonly font: import("@doki-land/davinci-types").FontSpec;
    /** Anchor point (where transform-origin of the text block lives). */
    readonly anchor?: Point2D;
    readonly color?: RGBA;
}

/** Marker — a reusable symbol placed at points (e.g., line endpoints, scatter glyphs). */
export interface SemanticMarker extends BaseSemantic, SemanticTransform {
    readonly kind: "marker";
    readonly markerId: string;
    /** Positions to place copies of this marker. */
    readonly positions: ReadonlyArray<Point2D>;
    readonly angle?: number;
}

export type SemanticShape =
    | SemanticPath
    | SemanticRect
    | SemanticEllipse
    | SemanticImage
    | SemanticText
    | SemanticMarker;

export type SemanticNode = SemanticGroup | SemanticShape;

/** The root of a semantic scene. Always a group. */
export interface SemanticScene {
    /** Contract namespace this scene was built under (`/v0` before 1.0.0). */
    readonly version: SceneVersion;
    readonly root: SemanticGroup;
}

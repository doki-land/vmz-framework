// DisplayScene — backend-ready, no domain semantics retained.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §4.
//
// Every transform is pre-composed, every clip is inherited and intersected,
// every bounds is final. Renderers consume this directly — no data reload,
// no scale inference, no layout recomputation.

import type { Affine2D, BoundsRect, Path, RGBA } from "@doki-land/davinci-types";
import type { SceneVersion } from "./version.js";

/** Final stroke style (resolved). */
export interface DisplayStroke {
    readonly color: RGBA;
    readonly width: number;
    readonly dash?: ReadonlyArray<number>;
}

/** Final fill style (resolved). */
export interface DisplayFill {
    readonly color: RGBA;
}

/** A resolved node — everything is final; no upstream semantics leak through. */
export interface DisplayNodeBase {
    /** Fully composed transform (local * parent chain). */
    readonly worldTransform: Affine2D;
    /** Inherited-and-intersected clip rect (if any). */
    readonly worldClip?: BoundsRect;
    /** Final axis-aligned bounds in world space. */
    readonly bounds: BoundsRect;
}

export interface DisplayGroup extends DisplayNodeBase {
    readonly kind: "group";
    readonly children: ReadonlyArray<DisplayNode>;
}

export interface DisplayPath extends DisplayNodeBase {
    readonly kind: "path";
    readonly path: Path;
    readonly stroke?: DisplayStroke;
    readonly fill?: DisplayFill;
}

export interface DisplayRect extends DisplayNodeBase {
    readonly kind: "rect";
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly rx: number;
    readonly ry: number;
    readonly stroke?: DisplayStroke;
    readonly fill?: DisplayFill;
}

export interface DisplayEllipse extends DisplayNodeBase {
    readonly kind: "ellipse";
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
    readonly stroke?: DisplayStroke;
    readonly fill?: DisplayFill;
}

export interface DisplayImage extends DisplayNodeBase {
    readonly kind: "image";
    readonly resourceRef: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface DisplayText extends DisplayNodeBase {
    readonly kind: "text";
    readonly text: string;
    /** CSS font string — host-formatted from FontSpec. */
    readonly fontCss: string;
    readonly anchor: { x: number; y: number };
    readonly color: RGBA;
}

export type DisplayNode =
    | DisplayGroup
    | DisplayPath
    | DisplayRect
    | DisplayEllipse
    | DisplayImage
    | DisplayText;

/** The root of a display scene. Always a group. */
export interface DisplayScene {
    /** Contract namespace this scene was resolved under (`/v0` before 1.0.0). */
    readonly version: SceneVersion;
    readonly root: DisplayGroup;
    /** Optional background color. */
    readonly background?: RGBA;
    /** Logical canvas dimensions. */
    readonly width: number;
    readonly height: number;
}

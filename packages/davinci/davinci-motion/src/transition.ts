// Transition plan — between two matched DisplayNodes.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §8.

import type { DisplayNode } from "@doki-land/davinci-scene";

/** Easing function — t ∈ [0, 1] → t ∈ [0, 1]. */
export type EasingFn = (t: number) => number;

/** Preset easing names. */
export type EasingPreset = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

/** Animatable property. */
export type AnimatableProp = "x" | "y" | "w" | "h" | "cx" | "cy" | "rx" | "ry" | "opacity" | "color" | "transform";

/** One property animation segment. */
export interface PropertyAnim {
    readonly prop: AnimatableProp;
    readonly from: number | import("@doki-land/davinci-types").RGBA;
    readonly to: number | import("@doki-land/davinci-types").RGBA;
    readonly durationMs: number;
    readonly easing: EasingPreset | EasingFn;
}

/** A full transition plan for one node id. */
export interface TransitionPlan {
    readonly id: string;
    readonly kind: "enter" | "exit" | "update" | "no-op";
    /** Total duration ms (0 if enter with no from). */
    readonly durationMs: number;
    readonly properties: ReadonlyArray<PropertyAnim>;
}

/** Build transition plans from scene match results. */
export function planTransition(from: DisplayNode | null, to: DisplayNode | null, id: string): TransitionPlan {
    const properties: PropertyAnim[] = [];
    if (from === null && to !== null) {
        return { id, kind: "enter", durationMs: 250, properties };
    }
    if (from !== null && to === null) {
        return { id, kind: "exit", durationMs: 250, properties };
    }
    if (from === null && to === null) {
        return { id, kind: "no-op", durationMs: 0, properties };
    }
    // TODO: compare transform/bounds/style for real property-level diff.
    return { id, kind: "update", durationMs: 250, properties };
}

// Timeline — sample animation state at time t.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §8.

import type { TransitionPlan } from "./transition.js";

/** Interruption — a running transition can be cancelled and replaced. */
export interface InterruptConfig {
    /** When true, cancels the old transition immediately. */
    readonly cancel: boolean;
    /** When true, starts the new transition from the current rendered state. */
    readonly fromCurrentFrame: boolean;
}

/** A running timeline — tracks elapsed time and transition plans. */
export interface Timeline {
    readonly plans: ReadonlyArray<TransitionPlan>;
    /** Start time (monotonic seconds). */
    readonly startedAt: number;
    /** Whether the timeline has ended. */
    readonly done: boolean;
}

/** Create a timeline from a set of transition plans. */
export function createTimeline(plans: ReadonlyArray<TransitionPlan>, startedAt = 0): Timeline {
    return {
        plans,
        startedAt,
        done: plans.length === 0,
    };
}

/** Sample the timeline at a given time. Returns per-node progress values ∈ [0, 1]. */
export function sample(timeline: Timeline, timeSec: number): ReadonlyMap<string, number> {
    const progress = new Map<string, number>();
    for (const p of timeline.plans) {
        const elapsed = (timeSec - timeline.startedAt) * 1000;
        if (p.durationMs <= 0) {
            progress.set(p.id, 1);
        } else {
            progress.set(p.id, Math.min(1, Math.max(0, elapsed / p.durationMs)));
        }
    }
    return progress;
}

/** Default interruption — cancel and start from current frame. */
export const DEFAULT_INTERRUPT: InterruptConfig = { cancel: true, fromCurrentFrame: true };

// Invalidation graph — partition of nodes that must be re-evaluated together.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §7.
//
// The invalidation set tells the compile pipeline which nodes are stale and
// need recompile after a state change. Categories are intentionally coarse —
// fine-grained tracking is future work.

/** Invalidation category. */
export type InvalidationCategory = "overlay" | "style" | "viewport" | "measurement" | "layout" | "data" | "motion";

/** A set of nodes grouped by invalidation category. */
export interface InvalidationSet {
    /** Categories to re-run. */
    readonly categories: ReadonlySet<InvalidationCategory>;
    /** Optional explicit node ids (if empty, category applies to all nodes). */
    readonly nodeIds?: ReadonlySet<string>;
}

/** Empty invalidation set — nothing to recompile. */
export const EMPTY_INVALIDATION: InvalidationSet = { categories: new Set() };

/** Union two invalidation sets. */
export function unionInvalidation(a: InvalidationSet, b: InvalidationSet): InvalidationSet {
    const cats = new Set([...a.categories, ...b.categories]);
    const mergedIds = new Set<string>();
    if (a.nodeIds) for (const id of a.nodeIds) mergedIds.add(id);
    if (b.nodeIds) for (const id of b.nodeIds) mergedIds.add(id);
    return { categories: cats, nodeIds: mergedIds.size > 0 ? mergedIds : undefined };
}

/** Derive invalidation from an action. */
export function deriveInvalidation(action: import("./event.js").Action): InvalidationSet {
    switch (action.kind) {
        case "hover":
        case "select-toggle":
        case "clear-selection":
            return { categories: new Set(["overlay"]) };
        case "viewport-pan":
        case "viewport-zoom":
            return { categories: new Set(["viewport", "overlay"]) };
        case "container-resize":
            return { categories: new Set(["measurement", "layout"]) };
        case "time-set":
        case "time-toggle-pause":
            return { categories: new Set(["motion"]) };
    }
}

// Runtime state — interaction-only, never mutates canonical domain.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §7.

/** Selection — stable ids of selected nodes. */
export interface SelectionState {
    readonly nodeIds: ReadonlySet<string>;
}

/** Viewport transform — pan + zoom. */
export interface ViewportState {
    /** Scale factor (1 = 100%). */
    readonly scale: number;
    /** Translation offset in logical pixels. */
    readonly tx: number;
    readonly ty: number;
}

/** Brush / filter rectangle (optional). */
export interface BrushState {
    readonly active: boolean;
    readonly rect?: { x: number; y: number; w: number; h: number };
}

/** Playback / animation state (time in seconds). */
export interface TimeState {
    /** Current elapsed time in seconds. */
    readonly now: number;
    /** Paused state. */
    readonly paused: boolean;
}

/** Container dimensions — set by host on resize. */
export interface ContainerState {
    readonly w: number;
    readonly h: number;
}

/** Unified runtime state bag. Flat for reducer ergonomics. */
export interface RuntimeState {
    /** Currently hovered node id (or null). */
    readonly hoveredId: string | null;
    /** Currently focused node id (or null). */
    readonly focusedId: string | null;
    /** Currently pressed node id (or null). */
    readonly pressedId: string | null;
    /** Disabled node ids. */
    readonly disabledIds: ReadonlySet<string>;
    readonly selection: SelectionState;
    readonly viewport: ViewportState;
    readonly brush: BrushState;
    readonly time: TimeState;
    readonly container: ContainerState;
}

/** Default initial runtime state. */
export function initialState(w: number, h: number): RuntimeState {
    return {
        hoveredId: null,
        focusedId: null,
        pressedId: null,
        disabledIds: new Set(),
        selection: { nodeIds: new Set() },
        viewport: { scale: 1, tx: 0, ty: 0 },
        brush: { active: false },
        time: { now: 0, paused: true },
        container: { w, h },
    };
}

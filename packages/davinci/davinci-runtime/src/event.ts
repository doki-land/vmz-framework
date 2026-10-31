// Normalized events + reducer — RuntimeState reducer pattern.

import type { RuntimeState } from "./state.js";

/** Pointer button. */
export type PointerButton = "primary" | "secondary" | "tertiary";

/** Normalized pointer event — single origin, no DOM. */
export interface NormalizedPointerEvent {
    readonly kind: "pointer";
    readonly type: "down" | "up" | "move" | "enter" | "leave";
    readonly x: number;
    readonly y: number;
    readonly button?: PointerButton;
    readonly shift?: boolean;
    readonly alt?: boolean;
    readonly ctrl?: boolean;
}

/** Normalized keyboard event. */
export interface NormalizedKeyboardEvent {
    readonly kind: "keyboard";
    readonly type: "down" | "up";
    readonly key: string;
    readonly shift?: boolean;
    readonly alt?: boolean;
    readonly ctrl?: boolean;
}

export type NormalizedEvent = NormalizedPointerEvent | NormalizedKeyboardEvent;

/** Abstract Action (user intent, NOT raw event). */
export type Action =
    | { readonly kind: "hover"; readonly nodeId: string | null }
    | { readonly kind: "select-toggle"; readonly nodeId: string; readonly additive?: boolean }
    | { readonly kind: "clear-selection" }
    | { readonly kind: "viewport-pan"; readonly dx: number; readonly dy: number }
    | { readonly kind: "viewport-zoom"; readonly delta: number }
    | { readonly kind: "container-resize"; readonly w: number; readonly h: number }
    | { readonly kind: "time-set"; readonly now: number }
    | { readonly kind: "time-toggle-pause" };

/** Reducer — pure, returns new state. */
export function reduce(state: RuntimeState, action: Action): RuntimeState {
    switch (action.kind) {
        case "hover":
            return { ...state, hoveredId: action.nodeId };
        case "select-toggle": {
            const ids = new Set(state.selection.nodeIds);
            if (ids.has(action.nodeId)) ids.delete(action.nodeId);
            else ids.add(action.nodeId);
            return { ...state, selection: { nodeIds: ids } };
        }
        case "clear-selection":
            return { ...state, selection: { nodeIds: new Set() } };
        case "viewport-pan":
            return { ...state, viewport: { ...state.viewport, tx: state.viewport.tx + action.dx, ty: state.viewport.ty + action.dy } };
        case "viewport-zoom": {
            const nextScale = Math.max(0.1, Math.min(10, state.viewport.scale * (1 + action.delta)));
            return { ...state, viewport: { ...state.viewport, scale: nextScale } };
        }
        case "container-resize":
            return { ...state, container: { w: action.w, h: action.h } };
        case "time-set":
            return { ...state, time: { ...state.time, now: action.now } };
        case "time-toggle-pause":
            return { ...state, time: { ...state.time, paused: !state.time.paused } };
    }
}

/** Dispatch a pointer event — hit test target → produce Action.
 *  Host provides hitTest function (overload point for domain-specific targetting). */
export function dispatchPointer(
    state: RuntimeState,
    ev: NormalizedPointerEvent,
    hitTest: (x: number, y: number) => string | null,
): Action | null {
    switch (ev.type) {
        case "move":
            return { kind: "hover", nodeId: hitTest(ev.x, ev.y) };
        case "down": {
            const target = hitTest(ev.x, ev.y);
            if (target) return { kind: "select-toggle", nodeId: target, additive: ev.shift };
            return { kind: "clear-selection" };
        }
        case "leave":
            return { kind: "hover", nodeId: null };
        default:
            return null;
    }
}

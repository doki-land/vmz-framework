/**
 * Public contract for `@vmz/ui-charts/Diagram`.
 *
 * Hand-written on purpose, same reason as `Chart.d.ts`: `.vmz` has no
 * TypeScript entry to bundle types from. Every member mirrors a `public`
 * member of `src/components/Diagram.vmz`.
 */

import type { DiagramSpec, DiagramTheme } from '@doki-land/davinci/diagram';
import type { DisplayScene } from '@doki-land/davinci/scene';
import type { Action, RuntimeState } from '@doki-land/davinci/runtime';

/** Layout direction override. */
export type DiagramDirection = 'LR' | 'RL' | 'TB' | 'BT';

/** Compile diagnostic surfaced on the component. */
export interface DiagramDiagnostic {
    severity: string;
    code: string;
    message: string;
}

/** Payload of {@link Diagram.ondiagramHover}. */
export interface DiagramHoverPayload {
    nodeId: string;
}

/** Payload of {@link Diagram.ondiagramSelect}. */
export interface DiagramSelectPayload {
    nodeId: string;
}

/**
 * Declarative diagram component: nodes / edges / clusters in, canonical scene
 * out. Selection and hover stay local unless the host reads them back.
 */
export default class Diagram {
    /** Diagram spec (nodes / edges / clusters). */
    spec: DiagramSpec | null;
    /** Layout direction; overrides `spec.direction`. */
    direction: DiagramDirection | null;
    /** `light` | `dark` | `auto`. */
    theme: string | null;
    /** Accessible name; a one-sentence summary is derived when omitted. */
    label: string | null;
    /** Prefix for generated resource ids (`data-dvz-id`). */
    resourceIdPrefix: string | null;
    /** Canonical display scene. */
    scene: DisplayScene | null;
    /** Last runtime state produced by the reducer. */
    state: RuntimeState | null;
    /** Compile diagnostics. */
    diagnostics: ReadonlyArray<DiagramDiagnostic>;

    /** Recompile the current spec (host-triggered refresh). */
    recompile(): void;
    /** Apply a runtime action (hover / select / pan / zoom / ...). */
    dispatch(action: Action): RuntimeState | null;
    /** Hover hook. */
    ondiagramHover(payload: DiagramHoverPayload): void;
    /** Selection hook. */
    ondiagramSelect(payload: DiagramSelectPayload): void;
}

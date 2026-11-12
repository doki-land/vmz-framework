/**
 * Public contract for `@vmz/ui-charts/Chart`.
 *
 * Hand-written on purpose: `.vmz` has no TypeScript entry to bundle types from,
 * and generated types would drop template-side defaults and the event surface.
 * Every member below mirrors a `public` member of `src/components/Chart.vmz`
 * plus the bubbling `CustomEvent`s the component dispatches.
 */

import type { ChartSpec, ChartTheme, DataSnapshot } from '@doki-land/davinci/chart';
import type { DisplayScene } from '@doki-land/davinci/scene';
import type { Action, RuntimeState } from '@doki-land/davinci/runtime';

/** Compile/selection diagnostic surfaced on the component. */
export interface ChartDiagnostic {
    severity: string;
    code: string;
    message: string;
}

/** Detail of the `vmz-chart-selection-change` event. */
export interface ChartSelectionChangeDetail {
    selection: string[];
}

/** Detail of the `vmz-chart-zoom-change` event. */
export interface ChartZoomChangeDetail {
    domain: [number, number] | null;
}

/** Detail of the `vmz-chart-legend-change` event. */
export interface ChartLegendChangeDetail {
    hidden: string[];
    isolated: string | null;
}

/** Detail of the `vmz-chart-drilldown-change` event. */
export interface ChartDrilldownChangeDetail {
    root: string;
    path: string[];
}

/** Detail of the `vmz-chart-focus` event. */
export interface ChartFocusDetail {
    rowKey: string | null;
    markId: string;
}

/** Payload of {@link Chart.onchartHover}. */
export interface ChartHoverPayload {
    rowKey: string | null;
    markId: string;
    x: number;
    y: number;
}

/** Payload of {@link Chart.onchartSelect}. */
export interface ChartSelectPayload {
    rowKey: string | null;
    markId: string;
}

/** Payload of {@link Chart.onchartBrush}. */
export interface ChartBrushPayload {
    markIds: string[];
}

/**
 * Declarative chart component.
 *
 * `spec` + `data` are the only required inputs: the component compiles them
 * with DaVinci and renders the resulting scene. Interactive state stays local
 * unless a prop (`selection` / `zoomDomain`) is supplied, which makes that
 * dimension controlled.
 */
export default class Chart {
    /** Chart spec (`mark` + `encoding`). */
    spec: ChartSpec | null;
    /** Row data bound through `encoding`. */
    data: Record<string, unknown>[] | null;
    /** Pre-built snapshot; wins over `data` when both are present. */
    snapshot: DataSnapshot | null;
    /** Explicit width in CSS px; measured from the host when omitted. */
    width: number | null;
    /** Explicit height in CSS px; measured from the host when omitted. */
    height: number | null;
    /** `light` | `dark` | `auto`. */
    theme: string | null;
    /** Accessible name; derived from the spec when omitted. */
    label: string | null;
    /** Prefix for generated resource ids (`data-dvz-id`). */
    resourceIdPrefix: string | null;
    /** Render the screen-reader table view instead of the SVG scene. */
    tableView: boolean;
    /** Theme token overrides merged over the active `ChartTheme`. */
    themeTokens: Partial<ChartTheme> | null;
    /** Renderer selection: `svg` | `canvas` | `auto`. */
    renderer: string | null;
    /** Tooltip trigger mode. */
    tooltipTrigger: string | null;
    /** Link group id shared across charts. */
    linkId: string | null;
    /** Controlled selection (scene mark ids). `null` keeps selection internal. */
    selection: string[] | null;
    /** Controlled zoom domain (`[min, max]`). `null` keeps zoom internal. */
    zoomDomain: number[] | null;
    /** Motion mode (`off` disables entrance/data animation). */
    motion: string | null;
    /** Last runtime state produced by the reducer. */
    state: RuntimeState | null;
    /** Compile and selection diagnostics. */
    diagnostics: ReadonlyArray<ChartDiagnostic>;

    /** Apply a runtime action (hover / select / pan / zoom / ...). */
    dispatch(action: Action): RuntimeState | null;
    /** Canonical display scene, or `null` before the first compile. */
    scene(): DisplayScene | null;
    /** Rendered SVG markup (empty before the first compile). */
    markup(): string;
    /** Hover hook; forwards to the `vmz-chart-focus` event path. */
    onchartHover(payload: ChartHoverPayload): void;
    /** Selection hook; emits `vmz-chart-selection-change`. */
    onchartSelect(payload: ChartSelectPayload): void;
    /** Brush hook; the host decides what a brushed range means. */
    onchartBrush(payload: ChartBrushPayload): void;
}

# @vmz/ui-charts

VMZ chart components backed by the DaVinci engine — the same `ChartSpec` + data rows drive SVG rendering, interaction, theming, and an accessible table fallback.

```vue
<Chart :spec="spec" :data="rows" label="Weekly visitors" />
```

```ts
const spec = {
    mark: "line", // see the mark catalog below
    encoding: [
        { field: "day", channel: "x" },
        { field: "visitors", channel: "y" },
        { field: "product", channel: "color" }, // series + legend
    ],
    // seriesLayout: "overlap" | "stack" | "dodge" | "percent"
    // innerRadiusRatio: 0.6                        (pie → donut)
    // facetField: "region"                         (small multiples)
    // keyField: "id"                               (stable row identity)
    // parentField: "parent"                        (treemap / sunburst / tree hierarchy)
    // treemapDepth: 3                              (levels drawn, frame root = 1)
    // treemapMinArea: 6                            (px² below which slivers are omitted, as are cells under 3px on either edge)
    // treemapRoot: "媒体"                           (drill-down root id)
    // valueDomain: [0, 100]                        (gauge)
    // spark: true                                  (strip all furniture)
};
```

## Mark catalog

Every mark renders real geometry with hit-testing, keyboard navigation, tooltips, a hidden data table, theme tokens, and an identical canvas backend path.

| Family | Marks | Notes |
|--------|-------|-------|
| Cartesian | `bar` / `rect`, `line`, `area`, `point` / `circle`, `dumbbell`, `lollipop` | `stack` / `dodge` / `percent` layouts; `yEnd` drives dumbbells |
| Scatter variants | `strip`, `beeswarm` | strip jitters deterministically from row keys; beeswarm packs collision-free |
| Distribution | `histogram`, `boxplot`, `violin`, `ridgeline` | binning / five-number / KDE all computed at compile time |
| Finance | `candlestick` | `open`/`high`/`low`/`close` channels, up/down tokens |
| Flow | `waterfall`, `funnel`, `sankey`, `streamgraph`, `gantt` | waterfall connectors, DAG-checked sankey, wiggle ribbons, date-aware gantt |
| Hierarchy | `treemap`, `sunburst`, `tree` | one `keyField` + `parentField` (+ `size`) contract; `treeLayout: "tidy" / "dendrogram" / "radial"`. `treemap` adds `treemapDepth`, `treemapMinArea` and `treemapRoot` (drill-down) |
| Part-to-whole | `pie` (+ donut), `mosaic`, `percent` layout | rose / radial-bar live under polar |
| Polar | `radar`, `rose`, `radial-bar`, `gauge` | 240° gauge with `valueDomain` |
| Grid | `heatmap`, `calendar` | sequential `heatmapRamp`; calendar takes strict `YYYY-MM-DD` |
| Density | `hexbin`, `contour` | compile-time hex grid / 2D KDE + marching squares, nice levels |
| Multi-axis | `parallel` | `dimensions: string[]`, one independent axis per entry |
| Network | `force`, `chord` | deterministic seeded force layout; chord shares the sankey edge list |
| Geo | `geo` | `geo: { map, projection }` + host-registered basemap (`registerGeoMap`); basemap packs are distributed separately |
| Aux channels | `size` (bubble), `yError` / `yErrorMinus` / `yErrorPlus`, `yLow` / `yHigh` (band) | composable with the base marks |

Stat-driven marks (`histogram`, `boxplot`, `ridgeline`, `bump`, `violin`, `calendar`, `streamgraph`, `mosaic`, `force`, `hexbin`, `contour`, `chord`) compute their statistics globally at compile time and therefore refuse `facetField` with an explicit diagnostic.

## Props

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `spec` | `ChartSpec` | — | mark + encodings (+ `seriesLayout`, `innerRadiusRatio`, `facetField`, `keyField`) |
| `data` / `snapshot` | rows / `DataSnapshot` | — | source rows; `data` is the usual path |
| `width` / `height` | `number \| null` | `null` | `null` measures the container (ResizeObserver) |
| `theme` | `"light" \| "dark" \| "auto"` | `"light"` | named base theme; `auto` follows the OS |
| `themeTokens` | `Partial<ChartTheme> \| null` | `null` | token overrides merged over the base theme |
| `label` | `string \| null` | derived | accessible name; also the table caption |
| `tableView` | `boolean` | `false` | render the data table instead of the SVG |
| `renderer` | `"svg" \| "canvas" \| "auto"` | `"svg"` | output backend; `auto` switches to canvas past 50k rows |
| `resourceIdPrefix` | `string \| null` | derived | SVG resource id prefix for edge cases |
| `selection` | `string[] \| null` | `null` | controlled selected mark ids; `null` leaves the selection owned by the component |

## Theming by token

`themeTokens` is a shallow merge over the active base theme (`light` / `dark`), so every presentation decision stays data-driven per chart — brand palette, quieter grid, heavier area fill:

```vue
<Chart :spec="spec" :data="rows" theme="dark" :themeTokens="brand" />
```

```ts
import { rgb8 } from "@doki-land/davinci/types";

const brand = {
    seriesPalette: [rgb8(5, 122, 85), rgb8(251, 146, 60)],
    markFill: rgb8(5, 122, 85),
    gridStroke: rgb8(220, 232, 225),
    areaFillOpacity: 0.35,
};
```

Available tokens: `seriesPalette`, `markFill`, `axisStroke`, `axisStrokeWidth`, `gridStroke` (`null` disables grid lines), `gridStrokeWidth`, `labelColor`, `labelFont`, `legendFont`, `pointStroke` (`null` disables the halo), `areaFillOpacity`, `heatmapRamp`, `upColor`, `downColor`, `trackColor`, `rangeTints`, `sankeyLinkOpacity`, `categoryColors`.

### Category colors (`categoryColors`)

A treemap colored by a `color` channel (file extension, media kind, owner…) reads its palette from the theme. The caller owns the mapping — the chart never hard-codes a category taxonomy:

```ts
const tokens = {
    categoryColors: new Map([
        ["视频", rgb8(37, 99, 235)],
        ["图片", rgb8(16, 185, 129)],
        ["文档", rgb8(245, 158, 11)],
    ]),
};
```

Categories missing from the map fall back to `seriesPalette`, indexed by **sorted category name** — reordering rows never recolors a node. Without a `color` channel the chart falls back to tinting the top-level groups, also in sorted order.

## Interaction

- Hover / focus shows real cell values; line and area charts get a crosshair that snaps to the nearest data x across all series.
- Arrow keys walk marks (line/area walk per-vertex values), `Enter` selects the focused mark and pins its tooltip, `Escape` unpins and clears the selection.
- Drag empty plot space to brush-select marks; shift+drag pans a quantitative x axis; the wheel zooms around the pointer; `+` / `-` / `0` zoom and reset from the keyboard.
- Treemap only: double-click a cell to drill into the nearest ancestor that has children (the matching rect is covered by its own children, so the target resolves up the `parentField` chain), double-click empty space (the top-left button, or `Escape`) to go back one level. Node ids stay `treemap:<key>`, so selection and palette survive reordering and redraws. The drill level follows data updates instead of outliving them: when a refresh removes the current root, the chart renders the deepest surviving ancestor, hides the back affordance, and bubbles `vmz-chart-drilldown-change` with the corrected `{ root, path }` (`root: null` at the document root). A level that disappears and comes back does not resurrect on its own, so a host that mirrors the event never shows a root the chart is not drawing.
- Host events: `onchartHover({ rowKey, markId, x, y })`, `onchartSelect({ rowKey, markId })`, `onchartBrush({ markIds })` — override them on the instance. `rowKey` is the hit row's `keyField` value and is what you look the record up with; it is `null` when the hit mark aggregates a whole series (one line path, one area band). `markId` is the scene node id (`treemap:视频`, `bar:0`) — the identity carried by `vmz-chart-selection-change` and by brush `markIds`. `rowKey` and `markId` are never interchangeable: the first indexes data, the second indexes marks. The same interactions bubble as `vmz-chart-selection-change`, `vmz-chart-zoom-change`, `vmz-chart-legend-change` and `vmz-chart-drilldown-change` (`{ root, path }`). Keyboard navigation additionally bubbles `vmz-chart-focus` with `{ rowKey, markId }`.

### Controlled selection

`selection` is the list of mark ids the chart should treat as selected. With the default `null` the component owns the selection: clicks, keyboard, and brush mutate it and bubble the result. An owned selection also follows data updates: mark ids the new rows can no longer produce are dropped, `vmz-chart-selection-change` bubbles the surviving set (an empty array when nothing survives), and restoring the rows does not resurrect a dropped id. Rows that are merely hidden by legend filtering or by a drill level keep their selection — the data still has them. Pass an array and the host owns it instead:

```vue
<Chart :spec="spec" :data="rows" :selection="selected" />
```

In controlled mode the component never applies a selection of its own. Each selection interaction instead bubbles the **proposed** set as `vmz-chart-selection-change` (`detail.selection`), and the host decides whether to store it:

| Interaction | Proposed set |
|-------------|--------------|
| click a mark, `Space`, `Enter` | the current `selection` with that mark toggled |
| click empty plot space, `Escape` | `[]` |
| brush drag | mark ids whose anchors fall inside the rect |

`onchartSelect({ rowKey, markId })` still fires per click in both modes — it reports the hit, not the resulting selection. Feeding the proposal back into `selection` is what makes the selection stick, so a host that ignores the event simply leaves the chart unchanged.

### What the markup carries and what it does not

`markup()` is a pure function of the resolved scene plus the selection, so the SVG string always describes real geometry: size, `spec` / `data`, theme tokens, `selection`, the current zoom view (`zoomDomain` or the interaction view) and the current drill root (both override the compiled spec before the scene is built), and legend filtering (hidden or isolated series are dropped when the snapshot is rebuilt).

Transient interaction presentation stays out of it by design:

| State | Where it lives | Why not in the markup |
|---|---|---|
| hover emphasis | inline `opacity` on the hit mark, replayed by `_applyDomState()` after every re-render | it is a pointer affordance, not chart state |
| legend entry dim | inline `opacity` on `legend:swatch:*` / `legend:label:*` | the legend keeps its node while the series is filtered, so the dim has no separate string form |
| brush rectangle, crosshair, tooltip | overlay elements next to the SVG | they are interaction chrome, not scene content |

Only `selection` gets a DOM attribute expression (`data-selected` / `aria-selected`); hover and legend dimming are presentation only. Server rendering starts from the declarative defaults — no zoom, no hidden series, the `treemapRoot` from the spec — so a fresh client hydrates the same markup as the server sent. After an interaction the client regenerates markup from runtime state and intentionally differs from the original SSR string; that is a post-hydration update, not a hydration mismatch, and re-rendering restores the state from the component, never from the old HTML.

### Disk-usage boards

A WizTree-style board composes the chart and the status bar on the app side — the chart emits identity and value, never the copy:

```ts
const tokens = {
    categoryColors: new Map([["视频", rgb8(37, 99, 235)], ["文档", rgb8(245, 158, 11)]]),
};
const spec = {
    mark: "treemap",
    keyField: "path",
    parentField: "parent",
    encoding: [{ field: "bytes", channel: "size" }, { field: "kind", channel: "color" }],
    treemapDepth: 4,
    treemapMinArea: 8,
};
// onchartSelect({ rowKey }) → look the row up and format bytes + path yourself.
```

## Accessibility

Every chart is `role="img"` with a derived or explicit `label`, plus a visually hidden data table linked via `aria-describedby` — screen readers get the actual numbers, not just a summary sentence. Selected marks carry `data-selected="true"` and `aria-selected="true"` in the SVG markup itself, so server-rendered output for an explicit `width` / `height` matches the client DOM instead of only gaining the state after an interaction. `tableView` swaps the SVG for that table for users who prefer it, and switches the container to `role="group"`. Tables render at most 1000 rows with an explicit truncation note. All motion respects `prefers-reduced-motion`.

## Diagnostics, not blank charts

Unknown fields, negative pie slices, unsupported marks, and invalid scale domains surface as structured diagnostics rendered under the chart (`severity` + `code`), never as a silent empty frame.

## Render backends

SVG is the default and the SSR path. `renderer="canvas"` paints the same resolved scene onto a canvas — measured on a 60k-point line: SVG serialization ~10 ms producing ~1 MiB of markup, canvas paint ~2 ms with no DOM weight. `renderer="auto"` switches to canvas past 50k rows. Hit-testing, crosshair, brush, and keyboard navigation read the semantic scene geometry and work identically on canvas; only the hover/selection opacity replay is SVG-specific (it maps `data-dvz-id` DOM hooks).

`data-selected` / `aria-selected` are SVG-only as well: the canvas backend draws pixels and has no per-mark DOM node to carry an attribute. On canvas the selection is observable through `vmz-chart-selection-change`, the pinned-tooltip live region, and `tableView` for the underlying numbers. Adding a DOM mirror of the display list just to hold attributes would put a second scene representation inside the component, which the renderer boundary forbids — the renderer serializes the scene, it does not re-derive it.

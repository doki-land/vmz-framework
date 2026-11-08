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
    // treemapMinArea: 6                            (px² below which slivers are omitted)
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
- Arrow keys walk marks (line/area walk per-vertex values), `Enter` selects, `Escape` clears.
- Drag empty plot space to brush-select marks; shift+drag pans a quantitative x axis; the wheel zooms around the pointer; `+` / `-` / `0` zoom and reset from the keyboard.
- Treemap only: double-click a node to drill into it as the new root, double-click empty space (the top-left button, or `Escape`) to go back one level. Node ids stay `treemap:<key>`, so selection and palette survive reordering and redraws.
- Host events: `onchartHover({ rowKey, x, y })`, `onchartSelect({ rowKey })`, `onchartBrush({ keys })` — override them on the instance. The same interactions bubble as `vmz-chart-selection-change`, `vmz-chart-zoom-change`, `vmz-chart-legend-change` and `vmz-chart-drilldown-change` (`{ root, path }`).

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

Every chart is `role="img"` with a derived or explicit `label`, plus a visually hidden data table linked via `aria-describedby` — screen readers get the actual numbers, not just a summary sentence. `tableView` swaps the SVG for that table for users who prefer it, and switches the container to `role="group"`. Tables render at most 1000 rows with an explicit truncation note. All motion respects `prefers-reduced-motion`.

## Diagnostics, not blank charts

Unknown fields, negative pie slices, unsupported marks, and invalid scale domains surface as structured diagnostics rendered under the chart (`severity` + `code`), never as a silent empty frame.

## Render backends

SVG is the default and the SSR path. `renderer="canvas"` paints the same resolved scene onto a canvas — measured on a 60k-point line: SVG serialization ~10 ms producing ~1 MiB of markup, canvas paint ~2 ms with no DOM weight. `renderer="auto"` switches to canvas past 50k rows. Hit-testing, crosshair, brush, and keyboard navigation read the semantic scene geometry and work identically on canvas; only the hover/selection opacity replay is SVG-specific (it maps `data-dvz-id` DOM hooks).

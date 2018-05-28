# @vmz/plugin-echarts

## Turn product data into an interactive view 📈

Tables are excellent for exact values, but they are poor at revealing a trend, an outlier, a changing distribution, or the relationship between several metrics. `@vmz/plugin-echarts` brings Apache ECharts to VMZ applications for the moments when users need to explore data rather than merely read it.

ECharts is a mature choice for dashboards, analytics panels, monitoring surfaces, reports, and embedded product insights. It offers a broad chart vocabulary and rich interaction without asking the surrounding VMZ page to become a chart-specific application.

## Where it fits

| Scenario | What ECharts adds |
|---|---|
| Operational dashboard | Dense, interactive views over changing metrics |
| Product analytics | Trends, comparisons, filters, and drill-down behavior |
| Technical documentation | Live visual examples when a static diagram is not enough |
| Existing ECharts product | A native VMZ boundary around familiar chart options |

## ECharts or Mermaid?

- Choose **ECharts** when the visualization is driven by data and users need tooltips, zooming, filtering, or exploration.
- Choose **Mermaid** when the visual explains a process, architecture, state machine, or sequence authored as text.
- Use ordinary content and tables when exact values matter more than visual exploration.

## Keep the chart in its place

ECharts owns drawing and interaction inside its host region. VMZ owns the page, data boundary, Island/client placement, lifetime, SSR fallback, tests, and delivery decision.

That separation matters on real dashboards: a powerful chart should become interactive when useful without forcing navigation, surrounding content, and every other panel into one eager browser runtime. ✨

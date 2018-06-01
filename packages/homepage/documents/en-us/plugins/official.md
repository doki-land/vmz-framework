# Official plugin whitelist

| Package                  | Author surface                          | Notes              |
|--------------------------|-----------------------------------------|--------------------|
| `@vmz/plugin`            | `definePlugin` / `defineConfig`         | Protocol           |
| `@vmz/plugin-katex`      | `<Katex>` / `<Math engine="katex">`     | `engines.math`     |
| `@vmz/plugin-mathjax`    | `<Mathjax>` / `<Math engine="mathjax">` | `engines.math`     |
| `@vmz/plugin-shiki`      | `<Shiki>` / `<Code engine="shiki">`     | `engines.code`     |
| `@vmz/plugin-monaco`     | `<Monaco>`                              | Concrete component |
| `@vmz/plugin-codemirror` | `<Codemirror>`                          | Concrete component |
| `@vmz/plugin-mermaid`    | `<Mermaid>`                             | Concrete component |
| `@vmz/plugin-echarts`    | `<Echarts>`                             | Concrete component |
| `@vmz/plugin-iconify`    | `<Iconify>`                             | Concrete component |

**Engine slots are only math / code.** Those contracts are homogeneous enough for `<Math>` / `<Code>` facades. Monaco,
Mermaid, ECharts, and Iconify differ too much in capability — use the concrete tags; no
`<Editor>` / `<Diagram>` / `<Chart>` / `<Icon>` facades.

**vs DaVinci:** ECharts / Mermaid are VMZ media components. DaVinci is parallel and not production-ready; prefer
`<Echarts>` for shipping charts.

```ts
import {defineConfig} from 'vmz';
import katex from '@vmz/plugin-katex';
import shiki from '@vmz/plugin-shiki';
import monaco from '@vmz/plugin-monaco';
import mermaid from '@vmz/plugin-mermaid';
import echarts from '@vmz/plugin-echarts';
import iconify from '@vmz/plugin-iconify';

export default defineConfig({
    plugins: [katex, shiki, monaco, mermaid, echarts, iconify],
    engines: {
        math: 'katex',
        code: 'shiki',
    },
});
```

See [Relative to the default path](./not-recommended.md).

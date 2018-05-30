# 官方插件白名单

媒体 / 文档 / 编辑类有引擎阻抗，由官方维护。

| 包                       | 作者表面                                | 说明           |
|--------------------------|-----------------------------------------|----------------|
| `@vmz/plugin`            | `definePlugin` / `defineConfig`         | 协议           |
| `@vmz/plugin-katex`      | `<Katex>` / `<Math engine="katex">`     | `engines.math` |
| `@vmz/plugin-mathjax`    | `<Mathjax>` / `<Math engine="mathjax">` | `engines.math` |
| `@vmz/plugin-shiki`      | `<Shiki>` / `<Code engine="shiki">`     | `engines.code` |
| `@vmz/plugin-monaco`     | `<Monaco>`                              | 具体组件       |
| `@vmz/plugin-codemirror` | `<Codemirror>`                          | 具体组件       |
| `@vmz/plugin-mermaid`    | `<Mermaid>`                             | 具体组件       |
| `@vmz/plugin-echarts`    | `<Echarts>`                             | 具体组件       |
| `@vmz/plugin-iconify`    | `<Iconify>`                             | 具体组件       |

**引擎槽仅 math / code：** 只有公式与代码高亮合同够同质，才 materialize `<Math>` / `<Code>`。Monaco、Mermaid、ECharts、Iconify
能力参差大，直接用组件名，不做 `<Editor>` / `<Diagram>` / `<Chart>` / `<Icon>` facade。

**与 DaVinci：** ECharts / Mermaid 是 VMZ 媒体组件；DaVinci 平行且未稳，产品图表优先 `<Echarts>`。

```ts
import { defineConfig } from 'vmz';
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

下一步：读 [明确不建议](./not-recommended.md)。

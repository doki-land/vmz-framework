# Homepage `/designs` — VMZ Design

本目录是 **VMZ 官方站点**（homepage + 一体文档）的 application design 真相源。

```text
brand.primary  Electric Cobalt  #176BFF
brand.energy   Pulse Amber      #FFB000
foundation     Ink / Graphite（非蓝黑）
```

**撤回**品牌绿。绿色只出现在 `status.success`，不承担 VMZ 身份。

所有权：

- 这里的 hex 属于 **VMZ Design**（本 application）
- `@vmz/ui` 通过 semantic token 消费这些值，而不是在组件里写死 hex
- `semantic-action.json` 提供 `action.primary.*` / `action.secondary.*` / `focus.ring`
- `semantic-motion.json` 提供 `motion.control.*` / `motion.overlay.*`（duration / easing）
- `semantic-status.json` 提供 `status.{info,success,warning,danger}.{accent,foreground}`；`status.info` ≠ `brand.primary`
  ；success ≠ 撤回品牌绿
- `semantic-density.json` 提供 `density.control.*` / `density.compact.*` / `density.dense.*`；
  `data-density="compact|dense"` 激活对应间距
- `document/chrome.css` 一体文档 chrome 同样消费 density token（与 `/product` / UI6 同一激活合同）
- `themes/high-contrast.json` 为高对比 overlay（`data-theme="high-contrast"`）；官方 `@vmz/ui` preset `web-surface`
  materialize 进本目录
- 其他 VMZ 项目可自行选择色板

面积比目标（视觉，非编译强制）：Paper/Mist/Ink ~70%，结构灰 ~20%，钻蓝 ~8%，琥珀 ~2%。

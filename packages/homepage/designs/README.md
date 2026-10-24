# Homepage `/designs` — VMZ Design

本目录是 **VMZ 官方站点**（homepage + 一体文档）的 application design 真相源。完整数值与组件质量条见 [`06-Style-Design-UI.md`](../../../../规划设计/vmz/06-Style-Design-UI.md) 的「商业稳重视觉基线 v2」。

```text
brand.primary  Commercial Blue  #1677FF
brand.energy   Pulse Amber      #FAAD14（少量强调）
surface        Page #F5F6F8 / Paper #FFFFFF / Mist #F7F8FA
text           Ink #1F2329 / Steel #51565D / Tertiary #646A73 / Muted #8A9099
line           Default #E5E6EB / Subtle #F0F1F3 / Strong #C9CDD4
```

所有权：

- 这里的 hex 属于 **VMZ Design**（本 application）。
- `@vmz/ui` 通过 semantic token 消费这些值，不在组件里写死 hex。
- `semantic-action.json` 提供 `action.primary.*` / `action.secondary.*` / `action.link.*` / `focus.ring`。
- `semantic-layout.json` 提供 `space.*` / `layout.*` / `type.*` / `elevation.*`。
- `semantic-density.json` 提供 `density.*`、`control.height.*`、`radius.*`、`shadow.*`。
- `semantic-motion.json` 提供 `motion.control.*` / `motion.emphasis.*` / `motion.overlay.*`。
- `semantic-status.json` 提供 `status.{info,success,warning,danger}.{accent,foreground,background,border}`；`status.info` ≠ `brand.primary`。
- `themes/dark.json` 与 `themes/high-contrast.json` 为 overlay；`data-density="compact|dense"` 激活对应间距。
- 字体使用系统无衬线/等宽栈，不加载远程 Web Font。
- 其他 VMZ 项目可自行选择色板；官方 `@vmz/ui` preset `web-surface` 与本目录 materialize 同步。

面积比目标（视觉，非编译强制）：Paper/Mist/Ink ~70%，结构灰 ~20%，商业蓝 ~8%，琥珀 ~2%。阴影只用于浮层，常态卡片保持平面。

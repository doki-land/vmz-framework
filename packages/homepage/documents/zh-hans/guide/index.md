# 入门

VMZ 是基于 **oxc** 的全栈应用编译系统：Vue 熟悉型表面，oxc 原生编译， **VMZ 原生语义**。

**约定大于配置** — 目录即路由 / 组件 / 服务端入口；配置只处理例外。品牌展开为 **Vue-Familiar · Multi-Platform ·
Zero-Cost**。

```bash
pnpm add @vmz/core
pnpm add -D @vmz/vmz
```

需要官方 UI 时再装 `@vmz/ui`；需要编译器插件时再装 `@vmz/plugin-*`。

配置优先使用带类型提示的：

```ts
import {defineConfig} from 'vmz';

export default defineConfig({
    plugins: [],
});
```

- [Zero-Cost](./zero-cost.md)
- [优化](./optimizations/index.md)
- 更多用法见本站 `/d/` 下的指南与插件文档

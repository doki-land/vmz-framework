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

官方插件统一是工厂：`pluginName(optional config)`，注册时写 `katex()` 而不是 `katex`。

带 `documents/` 的站点还需要 Markdown 引擎，包、插件、引擎三项都要配：

```ts
import {defineConfig} from 'vmz';
import markdownIt from '@vmz/plugin-markdown-it';

export default defineConfig({
    plugins: [markdownIt()],
    engines: {markdown: 'markdown-it'},
});
```

只装包或只注册插件都会在 `vmz dev` 挂载文档时失败。

官方 UI 的样式值来自项目 `designs/`。安装 `@vmz/ui` 后，用内置 preset 生成一份可改的起点：

```bash
pnpm add @vmz/ui
pnpm exec vmz init design
```

默认把 `web-surface` preset 物化到 `designs/`，已有文件会被跳过。要覆盖写用 `--force`，先看会写什么用 `--dry-run`，换目录用 `--designs-dir <dir>`，换 preset 用 `--preset <name>`。preset 只是 Style Theme 文件的初值，不是运行时主题，也不会被应用自动注入。

编译器只要求**模板里实际引用到的组件**提供 token。没有用到的依赖组件即使用到未定义的 token 也不算错误；真正缺失时诊断指向项目 `designs/`，不会指向 `node_modules`。

- [Zero-Cost](./zero-cost.md)
- [优化](./optimizations/index.md)
- [部署](./deploy/index.md)
  - [常见配方](./deploy/recipes.md)
  - [纯静态平台填写清单](./deploy/static-hosts.md)
  - [计划器](./deploy/planner.md)
  - [`vmz deploy`](./deploy/cli.md)
  - [密钥与环境变量](./deploy/secrets-env.md)
  - [配置参考](./deploy/config-reference.md)
- 更多用法见本站 `/d/` 下的指南与插件文档

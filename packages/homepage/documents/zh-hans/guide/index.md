# 入门

VMZ 是基于 **oxc** 的全栈应用编译系统：Vue 熟悉型表面，oxc 原生编译， **VMZ 原生语义**（不是 Vue / React 兼容层）。

```bash
pnpm add -D vmz
```

配置优先使用带类型提示的：

```ts
import {defineConfig} from 'vmz';

export default defineConfig({
    plugins: [],
});
```

更多用法见本站 `/d/` 下的指南与插件文档。

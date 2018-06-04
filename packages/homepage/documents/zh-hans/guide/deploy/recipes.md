# 部署配方

下列片段可直接放进项目根 `vmz.config.ts`。未列出的高级字段请看 [配置参考](./config-reference.md)。

## web-static — 只有 CDN / 对象存储

适合：营销站、文档站、无密钥的公开内容。

源码可以有 `<script server>`：该配方只交付**可静态证明**的 HTML/资源；运行时 server / `secret()` 依赖不会出现在静态托管上——见 [纯静态平台填写清单](./static-hosts.md)。

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-static',
    profiles: {
      'web-static': { host: 'browser', assembly: 'static-cdn' },
    },
  },
})
```

```bash
vmz build --profile web-static
vmz serve --profile web-static   # 预览合同，不会用 SPA fallback 掩盖缺页
```

## web-ssr — 单机全栈（默认）

适合：一台 Node 同时出 HTML 与 API。

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-ssr',
    profiles: {
      'web-ssr': {
        host: 'browser',
        assembly: 'server-host',
        serverRuntime: 'node',
      },
    },
  },
})
```

```bash
vmz build
vmz serve
```

无 `delivery` 配置时，CLI 默认也按 `web-ssr` 装配。

## web-hybrid — CDN + 独立服务端

适合：静态资源上 CDN，动态路由 / RPC 在另一台 host。

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-hybrid',
    profiles: {
      'web-hybrid': {
        host: 'browser',
        assembly: 'cdn+server',
        serverRuntime: 'node',
      },
    },
  },
})
```

## web-client — 纯前端 / 本地盘

适合：练习、无 server 的 UI。**不要**把带密钥的生产应用写成这个配方。

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-client',
    profiles: {
      'web-client': { host: 'browser', assembly: 'local-static' },
    },
  },
})
```

## rust-embedded — 嵌入基线 + 整包回退

适合：桌面壳、面板、必须离线启动又可远程换整包的产品。

```ts
import { defineConfig, defineSite } from 'vmz'

export default defineConfig({
  application: { id: 'panel' },
  delivery: {
    default: 'panel-embedded',
    profiles: {
      'panel-embedded': {
        host: 'browser',
        assembly: 'rust-embedded',
        sources: defineSite({
          artifact: 'web-production',
          sources: [
            { id: 'installed', kind: 'filesystem', directory: './site', trust: 'signed-release' },
            { id: 'updates', kind: 'remote', baseUrl: 'https://updates.example.com/panel/', trust: 'signed-release' },
            { id: 'baseline', kind: 'embedded', artifact: 'baseline' },
          ],
          resolution: { mode: 'release', fallback: ['installed', 'updates', 'baseline'] },
          activation: 'atomic',
        }),
      },
    },
  },
})
```

回退是**整份 release**，不会用 A 版本的 HTML 去拼 B 版本的 JS。

## 切换配方

同一仓库可声明多个 `profiles`，构建时选择：

```bash
vmz build --profile web-static
```

选平台与发布方式、生成 **agent 提示词**：见 [计划器](./planner.md)（站点路由 ``/deploy-planner``）。  
真正上线编排见 [`vmz deploy`](./cli.md)；可选机器面 DeployPlan 由 agent 写出，勿手抄 JSON。

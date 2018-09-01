# 部署：先选拓扑，再写配置

`vmz.config.ts` 里的 `delivery` 字段看起来很多，是因为框架要同时表达：**代码跑在哪**、**产物怎么装配**、**同一份站点从哪读盘**。  
对作者来说，正确顺序不是背 `assembly` 枚举，而是先回答：**你手里有什么机器、信任边界在哪**。

## 三分钟选型

| 你的情况 | 用这个配方 | 构建 |
|----------|------------|------|
| 只有对象存储 / CDN，没有可信后端 | `static` | `vmz build --profile static` |
| 一台 Node（或日后 Rust host）跑整站 | `web-ssr`（默认） | `vmz build` |
| CDN 放静态，另有一台跑 SSR/API | `web-hybrid` | `vmz build --profile web-hybrid` |
| 本地盘预览 / 纯前端练习 | `web-client` | `vmz build --profile web-client` |
| 桌面/面板：二进制里嵌站点，还可整包更新 | `rust-embedded` + `sources` | 见 [配方](./recipes.md) |

有**登录态、密钥、私有数据库**时，不要把生产站点建成「纯静态 CDN」——构建期会拒绝把可信 server 能力偷降到浏览器。

## 推荐阅读顺序

1. 本页（拓扑卡片）
2. [常见配方](./recipes.md) — 可复制的最小配置
3. [纯静态平台填写清单](./static-hosts.md) — CF Pages / GitHub Pages / Vercel / Netlify / EdgeOne（控制台 · CI · 本地推送）
4. （可选）互动计划器路由 `/deploy-planner`（说明见 [planner.md](./planner.md)）— 勾选后复制 **agent 提示词**（落地配置交给助手；可行性交给 check/build）
5. [`vmz deploy`](./cli.md) — 平台 adapter + `ship`（`git-ci` / `direct-upload`）
6. 最后才读 [配置参考](./config-reference.md) — 全字段

密钥与本地 env 放法见 [密钥与环境变量](./secrets-env.md)（支持 pnpm workspace 根目录）。

设计真相源里的完整管线与正交轴见 Living `04`（实现仓不要求用户去读协议长文）。

# 部署配置参考

本页是**后读**参考。日常请先走 [拓扑选型](./index.md) 与 [配方](./recipes.md)。

## `delivery` 两种写法

1. **推荐：** `default` + `profiles`（具名配方）
2. **兼容糖：** 只有 `artifact` + `sources` 时，构建期展开成单个 profile（有 sources 时偏 `rust-embedded`）

## 字段速查

| 字段 | 含义 |
|------|------|
| `default` | `vmz build` 未传 `--profile` 时使用的 id |
| `profiles.<id>.host` | 当前 Browser 期仅 `browser` |
| `profiles.<id>.assembly` | `local-static` \| `web-static` \| `server-host` \| `cdn+server` \| `rust-embedded`（旧名 `static-cdn` 已废） |
| `profiles.<id>.name` | 产物子目录，落在 CLI `--out-dir`（默认 `dist`）下；省略 = profile id。CDN 惯例 `name: 'cdn'` → `dist/cdn` |
| `profiles.<id>.serverRuntime` | `server-host` / `cdn+server` 时：`node` \| `worker` \| `deno` \| `bun` \| `rust-host` |
| `profiles.<id>.sources` | 可选；`defineSite({ artifact, sources, resolution… })`，与装配正交 |
| `delivery.deploy.plan` | 可选；指向机器可读 DeployPlan（供 `vmz deploy --plan`）。**人手勿手抄**——由编码 agent / 工具生成；互动计划器主输出是 [提示词](./planner.md) |

## `ship`（发布方式，与平台正交）

写在 DeployPlan（或 `vmz deploy --ship`）上，不要焊进平台名：

| 值 | 含义 |
|----|------|
| `git-ci` | 只配 CI + 登记 secrets 名；上线靠手动 `git push` |
| `direct-upload` | 本机 check/build 后直传 |

凭证默认读 `.env.secrets*`；可用 `--secret NAME=VALUE` 一次性覆盖。详见 [`vmz deploy`](./cli.md)、[密钥](./secrets-env.md)。

## 与「执行位置」的区别

- **Route / capability 跑在 browser、build 还是 server**：由程序图证明，不是 `delivery` 开关。
- **`delivery`**：证明之后，**如何把产物装进你的机器拓扑**。

不要用全局 `ssr: true/false` 或 SPA fallback 掩盖缺口。

## 相关命令

```bash
vmz build [--profile <id>] [--release]
vmz serve --profile <id>
vmz check
vmz deploy [--ship git-ci|direct-upload] [--secret NAME=VALUE]…
```

构建会写入 `_vmz/pack-manifest.json`、`_vmz/assemble-manifest.json`、`_vmz/build-proof.json`（按配方打语义槽位）。

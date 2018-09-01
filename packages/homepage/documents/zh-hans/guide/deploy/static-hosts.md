# 纯静态托管平台填写清单

面向 **`static` / `static-cdn`**。

**两轴：**

1. **平台**（去哪）：Cloudflare Pages / GitHub Pages / Vercel / Netlify / 腾讯 EdgeOne …  
2. **发布方式 `ship`**（怎么上，与平台正交）：

| `ship` | 含义 |
|--------|------|
| `git-ci` | `vmz deploy` **只配 CI**；上线靠 **手动 `git push`** |
| `direct-upload` | `vmz deploy` **本机直传**（私有仓 / 无 Git 集成） |

| 项 | 值 |
|----|----|
| 配方 | `vmz build --release --profile static` |
| 发布根目录 | 以 `StaticDeliveryManifest` 为准（常见 `dist`） |
| 公开 env | 如 `VMZ_SITE_ORIGIN`；禁止把 secret 打进静态产物 |

源码可有 `<script server>`：该 profile 只交付可静态证明的面。互动计划器：`/deploy-planner`。

## 各平台（控制台共通字段）

| 平台 `kind` | 控制台要点 | `git-ci` 时 | `direct-upload` 时 |
|-------------|------------|-------------|---------------------|
| `cloudflare-pages` | 项目、域名；CI 时绑生产分支 | Actions + `CF_*` → push | 本机 wrangler/API |
| `github-pages` | Pages source / 域名 / base path | Actions + OIDC → push | 本机上传（`GH_TOKEN`） |
| `vercel` | Framework=Other；Output；域名 | workflow + `VERCEL_*` → push | 本机 `vercel deploy --prebuilt` |
| `netlify` | Publish dir；域名 | `NETLIFY_*` → push | 本机 `netlify deploy` |
| `tencent-edgeone` | 站点/域名；证书 | `TENCENTCLOUD_*` + `EDGEONE_*` → push | 本机直传（CLI 以腾讯文档为准） |

## 相关

- [常见配方](./recipes.md) · [计划器](./planner.md) · [`vmz deploy`](./cli.md) · [密钥与环境变量](./secrets-env.md)

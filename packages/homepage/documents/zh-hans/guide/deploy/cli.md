# `vmz deploy`：平台 × 发布方式

两轴正交，**不要**把「怎么发」焊进平台名：

| 轴 | 含义 | 例子 |
|----|------|------|
| **平台** `adapters[].kind` | 去哪 | `cloudflare-pages`、`vercel`… |
| **发布方式** `ship` | 怎么上 | `git-ci` / `direct-upload` |

| `ship` | `vmz deploy` 做什么 | 谁真正上线 |
|--------|---------------------|------------|
| `git-ci` | 配工作流 + 登记 secrets **名**（需管理 key） | 你 **手动 `git push`** 后由 CI |
| `direct-upload` | 本机 check → build → 直传 | 本机立刻上传 |

`direct-upload` 适合：仓库不想开源、托管不支持/不想用 Git 集成、只想从笔记本推一把。

## 凭证：默认读 secrets，也可一次性传参

| 方式 | 用法 |
|------|------|
| **默认** | 自动读 workspace / 项目根 `.env.secrets*`（与 `vmz check` 等同序） |
| **一次性** | `--secret NAME=VALUE`（可重复）：只覆盖本进程；**不写盘、不进 report/workflow** |
| **缺键** | error（只报名）；`--dry-run` 可先列缺名 |

**`ship=git-ci`：** 管理 key 允许来自 `.env.secrets*`，但工具链会给 **advice**：配 CI 更建议 `--secret` 一次性，避免长驻「能改 CI secrets」的 token。缺键仍是 error。

注意：shell history 可能留下 `--secret` 值；能用已注入的 CI env 时优先用环境，不必再打到命令行。

```bash
vmz deploy --dry-run
vmz deploy                         # 读 plan.ship；凭证默认来自 .env.secrets*
vmz deploy --ship git-ci --secret CF_API_TOKEN=… --secret GH_TOKEN=…
vmz deploy --ship direct-upload    # 覆盖 plan；token 也可 --secret
# 若 ship=git-ci：再手动 git push
```

## 做什么 / 不做什么

| 做 | 不做 |
|----|------|
| `git-ci`：写可提交的 CI 工作流；登记 secrets **名** | **在本机上传并宣称已上线** |
| `direct-upload`：先 `vmz check` 再 build 再 `adapter.publish` | check 失败仍上传 |
| 用 env / `--secret` token 调厂商 API（仅直传 / 仅 CI runner） | 把密钥写进产物或 workflow；在日志打印值 |
| 对「长驻管理 key」发 advice（可抑制） | 把该 advice 升成硬错误逼删 secrets 文件 |
| 按 adapter 消费交付合同 | 发明 SPA fallback |

## 最小用法

1. [计划器](./planner.md) 选平台 + 发布方式（或手写 plan）  
2. `vmz.config.ts` 挂 `deploy.plan`  
3. 按上表跑 `vmz deploy`

详见 [static-hosts](./static-hosts.md)、[密钥与环境变量](./secrets-env.md)。

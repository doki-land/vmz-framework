# 密钥与环境变量

VMZ 把 **声明** 和 **取值** 分开：

- 代码里：`import { secret } from '#server/secrets'` → `secret('PAYMENTS_API_KEY')`（只写名字）
- 环境里：同名环境变量或本地文件提供值  
- **值永不**进入 `vmz.config.ts`、Web 产物、Resume、日志或部署计划正文

## pnpm workspace：放在仓库根

有 `pnpm-workspace.yaml` 时，推荐在 **workspace 根**放一份，所有包共用：

```text
repo/                         ← workspace 根
  pnpm-workspace.yaml
  .env.example                ← 可提交（公共键名）
  .env.secrets.example        ← 可提交（密钥名清单，无真实值）
  .env.local                  ← gitignore，本地公共覆盖
  .env.secrets                ← gitignore，本地密钥
  .env.secrets.local          ← gitignore，个人覆盖
  packages/web-app/           ← 可选再放包级 .env*.local
```

加载顺序（后者覆盖前者；进程已有 env 之后还可叠命令行 `--secret`）见 Living `01`。不必每个 package 复制密钥文件。

## 两类键

| 类型 | 例子 | 进浏览器？ |
|------|------|------------|
| Secret | `PAYMENTS_API_KEY`（配合 `secret('…')`） | 否 |
| 公共 | `VMZ_PUBLIC_SITE_ORIGIN` | 仅此前缀，且需通过 check |

不要把密钥写进无前缀的「普通 `.env` 可提交文件」里指望安全——密钥请用 `.env.secrets*` 或托管平台的 Secret Store。

## 生产 / Cloudflare 等

部署计划器只会告诉你 **要填哪些变量名**。  
在 CF Pages / Workers / 容器控制台按同名注入即可；**不要**把 `.env.secrets` 打进发布产物。

**`vmz check` 会查 env/secret：** 图里用到的 `secret('NAME')`、以及 DeployPlan 的 `requiredEnv`，在当前环境（含 workspace 根 dotenv）缺绑定就会失败——只报名字，不报值。  
`vmz build` / **`ship=direct-upload` 的 `vmz deploy`** 在 check 失败时不得继续发布。  
**`ship=git-ci` 的 `vmz deploy`** 只配流水线并登记 secrets **名**；**本机不发布**，上线靠手动 `git push`。

**`vmz deploy` 凭证：** 默认自动读 `.env.secrets*`；也可用 `--secret NAME=VALUE` 一次性覆盖（不写盘）。配 CI 时若管理 key 只来自长驻 secrets 文件，工具链给 **advice**（非 error），建议改一次性传参——见 [`vmz deploy`](./cli.md)。

## 相关

- [部署选型](./index.md)
- [计划器](./planner.md)（外部步骤里的 env 名）
- [配方](./recipes.md)
- [`vmz deploy`](./cli.md)

# 部署计划器

用几道关于**物理设备、信任边界、外部托管**的选择题，生成一份 **给编码 agent 的落地提示词**。

**互动 MVP：** 打开站点路由 `/deploy-planner`（普通 VMZ 页，非编译器特判）。

## 计划器做什么 / 不做什么

| 做 | 不做 |
|----|------|
| 一键复制 **agent 提示词**（拓扑结论、硬约束、外部清单、建议命令） | 让人手抄 `deploy.plan.json` |
| 在提示词里写清 `delivery` **意图**与平台填写项 | 代替 `vmz check` / `vmz build` 做可行性证明 |
| 提示明显互斥的拓扑组合（选型警告） | 宣称「按此一定能上线」；发明第二套路由 / fallback |

**能不能行**以本机或 CI 的 `vmz check` / `vmz build` 为准。提示词只说明怎么装；机器可读 DeployPlan 若需要，由 agent 写出供 `vmz deploy` 消费。

## 问卷（`T.*`）

1. 密钥 / 会话 / 私有库是否必须留在可信服务器？  
2. 首屏 HTML 从哪来？（CDN 预生成 / 请求时 SSR / 纯浏览器）  
3. 静态资源放哪？（同机 / CDN / 嵌进二进制）  
4. 服务端进程？（无 / Node / Worker / Rust）  
5. 要不要嵌入基线 + 远程整包更新？  
6. **外部托管平台**（可多选）：Cloudflare Pages、GitHub Pages、Vercel、Netlify、EdgeOne、Workers…  
7. **怎么发布**（与平台正交）：Git CI（配流水线 + 手动 push）/ 本机直传  

## 提示词应包含

1. 角色与目标；免责声明（≠ 已通过 check/build）  
2. 拓扑结论：`profile` / `assembly` / `ship` / 平台 / `requiredEnv` 名  
3. 硬约束：`git-ci` vs `direct-upload`、`--secret` advice、禁止手抄 JSON  
4. 请完成的步骤 + delivery 意图 + 外部填写清单  
5. 深链：[static-hosts](./static-hosts.md) · [密钥](./secrets-env.md) · [`vmz deploy`](./cli.md)

配方见 [选型](./index.md) / [recipes](./recipes.md)。

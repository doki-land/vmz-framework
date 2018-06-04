# Deploy planner

Answer questions about **machines, trust, and external hosting** to get an **agent prompt** you paste into a coding assistant.

**Interactive MVP:** open site route `/deploy-planner` (ordinary VMZ page — no compiler special-case).

## What it does / does not do

| Does | Does not |
|------|----------|
| One-click **agent prompt** (topology, constraints, console checklist, suggested commands) | Ask humans to hand-copy `deploy.plan.json` |
| Embed `delivery` **intent** and platform fill-ins inside the prompt | Prove feasibility (`vmz check` / `vmz build` do that) |
| Warn about conflicting topology choices | Claim “this will definitely ship”; invent vendor routing semantics |

**Whether it works** is decided by `vmz check` / `vmz build`. The prompt is a construction brief; if a machine-readable DeployPlan is needed, the **agent** writes it for `vmz deploy`.

## Questionnaire (`T.*`)

1. Secrets / sessions / private DB on a trusted server?  
2. Where first HTML comes from  
3. Where static assets live  
4. Server process (none / Node / Worker / Rust)  
5. Embedded baseline + remote whole-release updates?  
6. **Host platforms** (multi-select)  
7. **How to ship** (orthogonal): Git CI / direct upload  

## What the prompt must include

1. Role + disclaimer (not a passed check/build)  
2. Topology: `profile` / `assembly` / `ship` / platforms / `requiredEnv` names  
3. Hard rules: ship mode, `--secret` advice, no hand-copied JSON  
4. Steps + delivery intent + external checklist  
5. Deep links: [static-hosts](./static-hosts.md) · [secrets](./secrets-env.md) · [`vmz deploy`](./cli.md)

See [index](./index.md) and [recipes](./recipes.md).

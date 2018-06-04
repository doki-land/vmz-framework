# Deploy config reference

Read [topology picker](./index.md) and [recipes](./recipes.md) first.

## Two shapes

1. Preferred: `default` + `profiles`
2. Legacy sugar: `artifact` + `sources` expands to one profile at build time

## Field cheat sheet

| Field | Meaning |
|-------|---------|
| `default` | Profile when `vmz build` omits `--profile` |
| `profiles.<id>.host` | Browser era: `browser` only |
| `profiles.<id>.assembly` | `local-static` \| `static-cdn` \| `server-host` \| `cdn+server` \| `rust-embedded` |
| `profiles.<id>.serverRuntime` | For server assemblies: `node` \| `worker` \| `deno` \| `bun` \| `rust-host` |
| `profiles.<id>.sources` | Optional `defineSite({...})`; orthogonal to assembly |
| `delivery.deploy.plan` | Optional path to a machine-readable DeployPlan for `vmz deploy --plan`. **Do not hand-copy** — an agent/tool writes it; the interactive planner’s primary output is a [prompt](./planner.md) |

## `ship` (how to publish; orthogonal to platform)

Lives on the DeployPlan (or `vmz deploy --ship`), not baked into platform names:

| Value | Meaning |
|-------|---------|
| `git-ci` | Scaffold CI + register secret **names**; ship with a manual `git push` |
| `direct-upload` | Laptop check/build then upload |

Credentials default from `.env.secrets*`; optional one-shot `--secret NAME=VALUE`. See [`vmz deploy`](./cli.md) and [Secrets](./secrets-env.md).

## Placement vs delivery

- **Where a route/capability runs** is proven by the program graph.
- **`delivery`** only assembles proven partitions onto your topology.

No global `ssr: true/false`. No SPA fallback to hide missing pages.

## Commands

```bash
vmz build [--profile <id>] [--release]
vmz serve --profile <id>
vmz check
vmz deploy [--ship git-ci|direct-upload] [--secret NAME=VALUE]…
```

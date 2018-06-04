# `vmz deploy`: platform × ship mode

Two orthogonal axes — **do not** bake “how” into the platform name:

| Axis | Meaning | Examples |
|------|---------|----------|
| **Platform** `adapters[].kind` | Where | `cloudflare-pages`, `vercel`, … |
| **Ship** `ship` | How | `git-ci` / `direct-upload` |

| `ship` | What `vmz deploy` does | Who ships |
|--------|------------------------|-----------|
| `git-ci` | Scaffold workflow + register secret **names** | You **manually `git push`**, then CI |
| `direct-upload` | Laptop check → build → upload | Immediate publish |

Use `direct-upload` for private repos, hosts without Git integration, or occasional laptop pushes.

## Credentials: auto secrets file, or one-shot flags

| Source | Behavior |
|--------|----------|
| **Default** | Load workspace/project `.env.secrets*` (same order as other CLI) |
| **One-shot** | Repeatable `--secret NAME=VALUE` — process-only overlay; **never** written to disk, report, or workflow |
| **Missing** | **error** (names only); `--dry-run` may list missing names |

For **`ship=git-ci`**, management keys may still come from `.env.secrets*`, but the toolchain emits **advice** to prefer `--secret` for one-shot admin tokens. Missing keys remain errors.

Shell history may retain `--secret` values — prefer already-injected env when you can.

```bash
vmz deploy --dry-run
vmz deploy
vmz deploy --ship git-ci --secret CF_API_TOKEN=… --secret GH_TOKEN=…
vmz deploy --ship direct-upload
# if ship=git-ci: then git push
```

See [static hosts](./static-hosts.md), [Secrets & env](./secrets-env.md), [Planner](./planner.md).

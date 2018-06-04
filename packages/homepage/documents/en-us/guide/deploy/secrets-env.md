# Secrets and environment variables

VMZ separates **declaration** from **values**:

- In code: `secret('PAYMENTS_API_KEY')` via `#server/secrets` (names only)
- In the environment: same-named env vars or local files supply values  
- Values **never** enter `vmz.config.ts`, web artifacts, resume, logs, or deploy-plan bodies

## pnpm workspace: keep files at the repo root

With `pnpm-workspace.yaml`, put shared env at the **workspace root**:

```text
repo/
  pnpm-workspace.yaml
  .env.example
  .env.secrets.example
  .env.local                 # gitignored
  .env.secrets               # gitignored
  .env.secrets.local         # gitignored
  packages/web-app/          # optional package-level overrides
```

Load order (later wins; after process env, CLI `--secret` may overlay) is defined in Living `01`. Apps need not duplicate secret files.

## Two kinds of keys

| Kind | Example | In the browser? |
|------|---------|-----------------|
| Secret | `PAYMENTS_API_KEY` with `secret('…')` | Never |
| Public | `VMZ_PUBLIC_SITE_ORIGIN` | Only this prefix, and only if check allows |

## Production / Cloudflare

The deploy planner lists **variable names** to set in vendor consoles.  
Do not bake `.env.secrets` into release artifacts.

**`vmz check` includes env/secret:** reachable `secret('NAME')` bindings and DeployPlan `requiredEnv` must be present in the current environment (after workspace-root dotenv). Diagnostics name keys only, never values.  
`vmz build` / **`vmz deploy` when `ship=direct-upload`** must not publish if check failed.  
**`vmz deploy` when `ship=git-ci`** only scaffolds the pipeline and registers secret **names**; it does **not** publish from your laptop — you **push** to ship.

**`vmz deploy` credentials:** auto-load `.env.secrets*` by default; optional repeatable `--secret NAME=VALUE` for a one-shot process overlay (never persisted). For `git-ci`, long-lived management keys in the secrets file still work but get **advice** to prefer `--secret` — see [`vmz deploy`](./cli.md).

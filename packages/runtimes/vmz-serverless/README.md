# `@vmz/serverless`

VMZ **edge Fetch host** for Cloudflare Workers. Consumes a VMZ `server-host` build output (`vmz-runtime.js`, `vmz-routes.json`, `#server/*`) — not a parallel API layer.

## Deploy (homepage)

**Pages (static):** repo root — `pnpm home:client` → `packages/homepage/dist/cdn`

**Worker (API):** this package — after `pnpm home:server` at repo root:

```bash
npx wrangler deploy
```

## Stage manually

```bash
node scripts/stage-vmz-dist.mjs /path/to/vmz/dist/web-ssr
```

## Boundary

- Node server capability: `@vmz/server` (separate handoff)
- Author surface: VMZ `<script server>` only — no handwritten `/api/*` routes in this package

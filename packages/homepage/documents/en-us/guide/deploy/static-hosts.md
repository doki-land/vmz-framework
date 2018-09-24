# Static host fill-in checklist

For **`static` / `web-static`** (publish `dist/<name>`, convention `name: 'cdn'` → `dist/cdn`).

**Two axes:**

1. **Platform** (where): Cloudflare Pages / GitHub Pages / Vercel / Netlify / Tencent EdgeOne …  
2. **Ship mode** (how — orthogonal):

| `ship` | Meaning |
|--------|---------|
| `git-ci` | `vmz deploy` **only scaffolds CI**; shipping needs a **manual `git push`** |
| `direct-upload` | `vmz deploy` **uploads from the laptop** (private repo / no Git integration) |

| Item | Value |
|------|--------|
| Recipe | `vmz build --release --profile static` |
| Publish root | Trust `StaticDeliveryManifest` (often `dist`) |
| Public env | e.g. `VMZ_SITE_ORIGIN`; never ship secrets in the static artifact |

Source may include `<script server>`; this profile only ships what is statically proven. Planner: `/deploy-planner`.

## Platforms

| `kind` | Console | `git-ci` | `direct-upload` |
|--------|---------|----------|-----------------|
| `cloudflare-pages` | Project, domain; branch if CI | Actions + `CF_*` → push | Laptop wrangler/API |
| `github-pages` | Pages source / domain / base path | Actions + OIDC → push | Laptop upload (`GH_TOKEN`) |
| `vercel` | Framework=Other; Output; domain | Workflow + `VERCEL_*` → push | Laptop `vercel deploy --prebuilt` |
| `netlify` | Publish dir; domain | `NETLIFY_*` → push | Laptop `netlify deploy` |
| `tencent-edgeone` | Site/domain; cert | `TENCENTCLOUD_*` + `EDGEONE_*` → push | Laptop upload (CLI per Tencent docs) |

## Related

- [Recipes](./recipes.md) · [Planner](./planner.md) · [`vmz deploy`](./cli.md) · [Secrets & env](./secrets-env.md)

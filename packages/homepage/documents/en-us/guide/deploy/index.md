# Deploy: topology first, then config

`delivery` in `vmz.config.ts` looks large because it covers **where code may run**, **how artifacts are assembled**, and **where the same site is loaded from**.  
Authors should not memorize `assembly` enums first. Ask: **what machines and trust boundaries do you have?**

## Three-minute picker

| Your setup | Recipe | Build |
|------------|--------|-------|
| Object storage / CDN only, no trusted backend | `web-static` | `vmz build --profile web-static` |
| One Node (or later Rust host) for the whole site | `web-ssr` (default) | `vmz build` |
| CDN for static + separate SSR/API host | `web-hybrid` | `vmz build --profile web-hybrid` |
| Local disk / client-only practice | `web-client` | `vmz build --profile web-client` |
| Desktop/panel: embedded site + whole-release updates | `rust-embedded` + `sources` | See [recipes](./recipes.md) |

If you need **sessions, secrets, or a private database**, do not ship production as pure static CDN.

## Reading order

1. This page  
2. [Recipes](./recipes.md)  
3. [Static host fill-ins](./static-hosts.md) — CF Pages / GitHub Pages / Vercel / Netlify / EdgeOne (console · CI · local push)  
4. (Optional) interactive planner at `/deploy-planner` (notes in [planner.md](./planner.md)) — copy an **agent prompt** (assistant lands config; feasibility is check/build)
5. [`vmz deploy`](./cli.md) — platform adapters + `ship` (`git-ci` / `direct-upload`)
6. [Config reference](./config-reference.md) last  

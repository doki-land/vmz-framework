# Not recommended

These are common in Vue / React / Solid ecosystems. VMZ **does not** ship official `@vmz/plugin-*` bindings for them and
**does not** recommend them as the default approach. You may still install them privately — do not expect a second
semantic spine.

## Competes with core semantics

| Library / practice                                    | Why not                                              |
|-------------------------------------------------------|------------------------------------------------------|
| Pinia / Zustand / Jotai / Redux / Solid stores / Vuex | Competes with class-field reactivity + Program Graph |
| Vue Router / React Router / TanStack Router           | First-class SFC routes                               |
| `useX` / `createX` / hooks factories                  | Forbidden by syntax/component model                  |
| VDOM / whole-tree diff / full-page hydrate            | Updates must be dependency-driven patches            |

## Test / docs frameworks

| Library / practice                                               | Why not                                           |
|------------------------------------------------------------------|---------------------------------------------------|
| Vitest / Jest as the test spine                                  | Use `vmz test`                                    |
| Playwright / Cypress as default product test semantics           | Optional sidecar only                             |
| VitePress / Docusaurus / Astro / Next / Nuxt / MDX as docs spine | Use `vmz document`; this site is Integrated `/d/` |

## UI kits

| Library / practice                                           | Why not                      |
|--------------------------------------------------------------|------------------------------|
| Element Plus / Ant Design / MUI / Naive / Vuetify full ports | No official kit ports        |
| Tailwind utilities in plain `class`                          | Use `style:tw` / `@tailwind` |

For production interactive charts use official `<Echarts>` (`@vmz/plugin-echarts`). DaVinci is parallel and **not
production-ready**. Recharts / Chart.js may be direct deps; no second official chart component yet.

## Fetch / forms

| Library / practice                             | Why not                                        |
|------------------------------------------------|------------------------------------------------|
| TanStack Query / SWR as default fetch          | Dual-track with `#server` / AsyncTask / Island |
| React Hook Form / Formik / VeeValidate / Felte | Competes with field reactivity                 |

## OK to depend on directly (no official plugin)

**Zod / Valibot / dayjs / date-fns** can be imported in `<script>` without an official plugin. Use `@vmz/plugin` only
when you need compile-time contributions.

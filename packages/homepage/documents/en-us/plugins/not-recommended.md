# Relative to the default path

These libraries are common in Vue / React / Solid ecosystems. VMZ does **not** ship matching `@vmz/plugin-*` packages
and does **not** treat them as the default path. You can still install them privately; they do not enter the VMZ
semantic spine.

## Overlaps with core semantics

| Library / practice                                    | Relationship to the VMZ path                      |
|-------------------------------------------------------|---------------------------------------------------|
| Pinia / Zustand / Jotai / Redux / Solid stores / Vuex | Overlaps class-field reactivity + Program Graph   |
| Vue Router / React Router / TanStack Router           | Routing is first-class in VMZ                     |
| `useX` / `createX` / hooks factories                  | Outside the current syntax and component model    |
| VDOM / whole-tree diff / default full-page hydrate    | VMZ defaults to dependency-driven precise patches |

## Test / docs frameworks

| Library / practice                                               | Relationship to the VMZ path                                |
|------------------------------------------------------------------|-------------------------------------------------------------|
| Vitest / Jest as the test spine                                  | The spine is `vmz test`                                     |
| Playwright / Cypress as default product-test semantics           | Optional sidecar, outside the core story                    |
| VitePress / Docusaurus / Astro / Next / Nuxt / MDX as docs spine | Docs spine is `vmz document`; this site is Integrated `/d/` |

## UI kits

| Library / practice                                           | Relationship to the VMZ path              |
|--------------------------------------------------------------|-------------------------------------------|
| Element Plus / Ant Design / MUI / Naive / Vuetify full ports | No official full kit ports                |
| Tailwind utilities in plain `class`                          | Official path is `style:tw` / `@tailwind` |

For production interactive charts, prefer official `<Echarts>` (`@vmz/plugin-echarts`). DaVinci is parallel and not yet
stable as a production default. Recharts / Chart.js can be direct dependencies; there is no second official chart
component yet.

## Fetch / forms

| Library / practice                             | Relationship to the VMZ path                           |
|------------------------------------------------|--------------------------------------------------------|
| TanStack Query / SWR as default fetch          | Easy to dual-track with `#server` / AsyncTask / Island |
| React Hook Form / Formik / VeeValidate / Felte | Overlaps field reactivity                              |

## Fine as direct dependencies (no official plugin)

**Zod / Valibot / dayjs / date-fns** and similar framework-agnostic libraries can be imported in `<script>`. Use
`@vmz/plugin` when you need compile-time contributions (materialized components, engine registration).

Community packages may publish under other scopes; `@vmz/plugin-*` is for officially maintained plugins.

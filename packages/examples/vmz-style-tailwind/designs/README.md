# Design notes

- **Style Theme** is first-class and language-agnostic (`tokens/` + `themes/` + optional `theme.json`).
- Concrete values live in CSS custom properties (`vmz-designs.css`).
- TW utilities project the same keys as `var(--vmz-…)`, so `data-theme` switches both SCSS and TW.
- `theme.json.prefersColorScheme` maps OS scheme → ThemeId (CSS `@media` + host boot).
- Explicit choice (cookie / localStorage / toggle / `?theme=`) always sets the activation attr, including `data-theme="default"`, so it overrides OS preference.
- With no explicit choice, leave bare `<html>` — CSS `@media (prefers-color-scheme)` follows the OS.
- `styles/index.scss` is the global SCSS entry when present.
- Unknown `var(--vmz-…)` / semantic `style:tw` → `vmz::style::unknown_design_token`.
- Unused Style Theme leaves warn with `vmz::style::unused_design_token`.
- Orphan `designs/styles/*.scss` (not imported from `index.*`) warn with `vmz::style::unreferenced_global_style`.
- `vmz explain style bg-action` shows utility → token → CSS asset chain.

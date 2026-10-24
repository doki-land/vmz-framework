# `@vmz/commander`

i18n-first TypeScript CLI framework under the `@vmz` scope. **Not** bound to `@vmz/vmz`.

- Fluent registration; command / option second args are **message ids**
- **Help is derived** from the command tree — do not paste Usage walls into catalogs
- **Locales directory loading**: `locales.json` + `<locale>/*.json` → flatten → `LocalizePlugin`
- Framework chrome/err ids are `commander.*` with tiny English fallbacks (products may override)
- Interactive help uses a small ANSI theme for headings, commands, options, and errors; `NO_COLOR` disables it, `FORCE_COLOR` enables it outside a TTY
- **No product language packs** in this package

## Quick start

```ts
import { createCli } from '@vmz/commander';

const cli = createCli('my-cli')
  .locales(new URL('./locales', import.meta.url).pathname) // or absolute path
  .intro('cli.intro')
  .command('build', 'cli.cmd.build')
  .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
  .action(async (options) => {
    /* options._ positionals; options['out-dir'] … */
  });

await cli.parse(process.argv);
```

Locales layout (any product):

```text
<localesRoot>/
  locales.json          # { defaultLocale, locales: [{ id }], fallback? }
  en-US/*.json          # flat or nested → dotted ids
  zh-CN/*.json          # optional
```

`.locales(root)` also registers root `--locale <id>` (peeled before the command). Later `.use(plugin)` overrides the locales plugin.

## API surface

| API | Role |
|-----|------|
| `createCli(name)` | Program name; help `{name}` |
| `.command` / `.option` / `.action` / `.actionCtx` / `.passthrough` | Command tree |
| `.intro(id)` | Short banner only |
| `.locales(root)` / `.use(plugin)` / `.catalog(loader)` | Localization (later `.use` wins) |
| `.option` on CLI | Global flags (merged into action options) |
| `.onDiagnostic(handler)` | Route structured action failures to a product-owned renderer |
| `loadLocalesManifest` / `loadCatalog` / `flattenCatalog` | Filesystem catalog helpers |
| `createLocalizeFromLocales` | Build a `LocalizePlugin` from a root |
| `assertCatalogCoverage(cli, catalog)` | Dev/CI: registered helpIds must exist |
| `COMMANDER_FALLBACK_EN_US` | Minimal `commander.ui.*` / `commander.err.*` / `commander.opt.locale` |

`t` resolution: product catalog → `commander` English fallback → `{{id}}`.

## Option config

`.option(rawName, helpId, config?)` accepts runtime constraints in addition to the `<value>` / `[value]` / `...` syntax:

| Field | Behavior |
|-------|----------|
| `required` | Missing value before the action → structured parse error, exit code 2 |
| `enum` | Value outside the set → structured parse error, exit code 2 (repeatable values are checked per item) |
| `default` | Filled into `options[key]` when omitted (boolean, string, or array) |
| `coerce` | Runs on the supplied raw value, thrown errors become exit code 2 |
| `hidden` | Omitted from help, still parseable |
| `example` | Rendered after the option in help |
| `deprecated` | Annotated in help and emits a `commander::option_deprecated` warning when used |
| `group` | Rendered under its own help section while ungrouped options keep the default section |

Validation happens before the action handler runs. Failures carry stable `commander::*` codes plus structured `args`.

## Command boundaries

- `.actionCtx(handler)` receives `(options, args, ctx)`, with `ctx.help`, `ctx.stdout`, `ctx.stderr`, `ctx.fail`, `ctx.warn`, and `ctx.note`. `.action` and `.actionCtx` are mutually exclusive.
- `--` ends option parsing. Every token after it is a raw positional and is merged into `options._` — options and help markers in the tail are never reinterpreted.
- `--help` binds to the deepest command path reached before the marker, so `demo document check --help` and `help document check` show the same node.

## Diagnostics

Action failures may throw a language-neutral diagnostic object with `code`, `args`, `path`, `span`, `severity`, and optional legacy `message`. The configured handler receives the structured row and resolved locale context. Without a handler, commander renders the `code` through `t` with `args` interpolation, falling back to a real business message or the code. Plain `Error` exceptions are wrapped as `commander::action_failed` during migration. Commander does not own diagnostic formatting: products should connect `@vmz/diagnostic`.

Framework hints use `commander.ui.hint.available_options` (`{command}`) and `commander.ui.hint.did_you_mean` (`{suggest}`), so product catalogs can translate them. The available-options hint names the full executable command (`demo run --help`) and falls back to the root command for unknown commands.

## Layering

```text
@vmz/commander  = CLI tree + locales loader + commander.* chrome
@vmz/vmz        = product bin + command registration + locales/ content
@vmz/diagnostic = diagnostic layout (caller injects catalog / t)
```

Do **not** create a separate `@vmz/i18n` package for official product strings.

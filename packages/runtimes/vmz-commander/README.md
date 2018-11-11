# `@vmz/commander`

i18n-first TypeScript CLI framework under the `@vmz` scope. **Not** bound to `@vmz/vmz`.

- Fluent registration; command / option second args are **message ids**
- **Help is derived** from the command tree — do not paste Usage walls into catalogs
- **Locales directory loading**: `locales.json` + `<locale>/*.json` → flatten → `LocalizePlugin`
- Framework chrome/err ids are `commander.*` with tiny English fallbacks (products may override)
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
| `.command` / `.option` / `.action` / `.passthrough` | Command tree |
| `.intro(id)` | Short banner only |
| `.locales(root)` / `.use(plugin)` / `.catalog(loader)` | Localization (later `.use` wins) |
| `.option` on CLI | Global flags (merged into action options) |
| `loadLocalesManifest` / `loadCatalog` / `flattenCatalog` | Filesystem catalog helpers |
| `createLocalizeFromLocales` | Build a `LocalizePlugin` from a root |
| `assertCatalogCoverage(cli, catalog)` | Dev/CI: registered helpIds must exist |
| `COMMANDER_FALLBACK_EN_US` | Minimal `commander.ui.*` / `commander.err.*` / `commander.opt.locale` |

`t` resolution: product catalog → `commander` English fallback → `{{id}}`.

## Layering

```text
@vmz/commander  = CLI tree + locales loader + commander.* chrome
@vmz/vmz        = product bin + command registration + locales/ content
@vmz/diagnostic = diagnostic layout (caller injects catalog / t)
```

Do **not** create a separate `@vmz/i18n` package for official product strings.

# `@vmz/commander`

TypeScript CLI framework for VMZ tooling.

- Fluent registration; command / option args are **message ids**
- **Help is derived** from the command tree (`t(cmd.helpId)` / `t(opt.helpId)`) — do not paste Usage walls into catalogs
- **Pluggable localization** via `.use({ t, resolveLocale? })` — this package does **not** ship language packs
- Official catalogs live in `@vmz/vmz` (atomic ids + optional short `.intro(...)`)
- Library only — product bin remains `@vmz/vmz`

```ts
import { createCli } from '@vmz/commander';
import { vmzCliLocalize } from '@vmz/vmz'; // or a local plugin

const cli = createCli('vmz')
  .use(vmzCliLocalize)
  .intro('cli.intro.project') // short banner only; lists come from registration
  .command('build', 'cli.cmd.build')
  .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
  .action(async (options) => {
    /* options._ positionals; options['out-dir'] … */
  });

await cli.parse(process.argv);
```

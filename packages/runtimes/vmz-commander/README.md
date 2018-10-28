# `@vmz/commander`

TypeScript CLI framework for VMZ tooling.

- Fluent registration; command / option args are **message ids**
- **Pluggable localization** via `.use({ t, resolveLocale? })` — this package does **not** ship language packs
- Official catalogs live in `@vmz/vmz`; apps may plug in their own
- Library only — product bin remains `@vmz/vmz`

```ts
import { createCli } from '@vmz/commander';
import { vmzCliLocalize } from '@vmz/vmz'; // or a local plugin

const cli = createCli('vmz')
  .use(vmzCliLocalize)
  .help('cli.help.project')
  .command('build', 'cli.cmd.build')
  .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
  .action(async (options) => {
    /* options._ positionals; options['out-dir'] … */
  });

await cli.parse(process.argv);
```

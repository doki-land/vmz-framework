# `@vmz/commander`

TypeScript CLI framework for VMZ tooling.

- Fluent registration; command / option args are **message ids**
- **Pluggable localization** via `.use({ t, resolveLocale? })` — this package does **not** ship language packs
- Official catalogs live in `@vmz/vmz`; apps may plug in their own
- Library only — product bin remains `@vmz/vmz`
- Implement `parse` / help when the product CLI actually migrates here

```ts
import { createCli } from '@vmz/commander';

const cli = createCli('vmz')
  .use(myLocalizePlugin)
  .command('build', 'cli.cmd.build')
  .option('--out-dir <dir>', 'cli.opt.build.out-dir')
  .action(async () => {
    /* … */
  });

await cli.parse(process.argv);
```

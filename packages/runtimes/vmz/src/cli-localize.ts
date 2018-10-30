/**
 * Official CLI / diagnostic localization for `@vmz/vmz`.
 *
 * Catalogs live here — not in `@vmz/commander`, `@vmz/diagnostic`, or a separate
 * `@vmz/i18n` package. Plug into commander via `.use(vmzCliLocalize)`.
 */

import type { LocaleCatalog, LocalizePlugin } from '@vmz/commander';

/** Product `en-US` table. */
export const VMZ_CLI_CATALOG_EN_US: LocaleCatalog = {
    'cli.help.global': `vmz — global mode

Install faces: @vmz/core (runtime) · @vmz/vmz (this CLI) · optional @vmz/ui / @vmz/plugin-*

Three install modes:
  developer  monorepo source (packages/runtimes/vmz) — full CLI
  project    app node_modules/@vmz/vmz — full CLI
  global     npm/pnpm -g — only help/version (project commands need a project install)

You are in global mode. Pin \`@vmz/vmz\` in the app so check/build
use a traceable project install.

Usage:
  vmz version                   Show host + native protocol versions
  vmz help                      Show this help

Project commands:
  pnpm add @vmz/core && pnpm add -D @vmz/vmz
  pnpm exec vmz check

If a project \`node_modules/@vmz/vmz\` exists, a global
\`vmz <cmd>\` re-execs that bin.
`,

    'cli.help.project': `vmz — Node toolchain host (project / developer mode)

Usage:
  vmz check [path]              Check project via Workspace
  vmz build [path] [options]    Build project via Workspace; --target mini-program-wechat packs dist/wechat
  vmz serve [path] [options]    Serve dist (optional --build)
  vmz dev [path] [options]      Rebuild session; --target mini-program-wechat packs dist/wechat
  vmz format [path] [--check]   Format .vmz via N-API (oxc formatter + EditorConfig)
  vmz lint [path] [--deny-warnings]  Lint (= check) via N-API
  vmz test [path] [options]     Native test discover / report
  vmz document|docs <cmd>       Project /documents domain
  vmz application <cmd>         Application Collection / Mount
  vmz artifact <cmd>            Release pack / publish / rollback / diff (A3)
  vmz refactor <cmd>            DX rename plans / apply
  vmz explain [style] <target>  DX causal explain (style Theme chain)
  vmz plan <kind> [root]        Dump frozen Rust plans via N-API (locale | document-route)
  vmz version                   Show host + native protocol versions
  vmz help                      Show this help

Options:
  --out-dir, -o <dir>   Workspace output root (default: dist). Profile artifacts land in <out-dir>/<name> (name defaults to profile id; CDN: name:'cdn' → dist/cdn)
  --release             Release build (omit serve-host; pack minify slot; proof)
  --profile <name>      Delivery profile (default from config; builtins: web-ssr|static|web-client|web-hybrid)
  --target <id>         browser (default) | mini-program-wechat (pack dist/wechat for WeChat DevTools; build+dev)
  --origin <url>        Site origin for web-static canonical/sitemap
  --host <host>         Listen host (default: 127.0.0.1)
  --port <port>         Listen port (dev: omit = auto from 5173; set = lock)
  --poll-ms <ms>        Dev watch poll interval (default: 300)
  --build               Build before serve
  --check               Format check-only (format)
  --deny-warnings       Treat warnings as errors (lint)
  --list                List discovered tests (test)
  --json [file]         Emit TestReport / DocumentManifest / ApplicationCheckReport JSON
  --mode <modes>        compile|logic|browser|ssr|resume|deployment|all (test)
  --filter <pattern>    Filter by test id or file (test)
  --application <id>    Run only tests for ApplicationId (standalone scope)
  --mounted <id>        Run relocation + host-boundary tests for ApplicationId
  --affected            Select tests from dirty VPG units (test; DX)
  --root <dir>          Project root (document check)
  --strict              Strict document locale/PageKey coverage (document check)
`,

    'cli.cmd.check': 'Check project via Workspace',
    'cli.cmd.build': 'Build project via Workspace',
    'cli.cmd.serve': 'Serve dist (optional --build)',
    'cli.cmd.dev': 'Rebuild session',
    'cli.cmd.format': 'Format .vmz via N-API',
    'cli.cmd.lint': 'Lint (= check) via N-API',
    'cli.cmd.test': 'Native test discover / report',
    'cli.cmd.document': 'Project /documents domain',
    'cli.cmd.locale': 'Locale domain',
    'cli.cmd.application': 'Application Collection / Mount',
    'cli.cmd.artifact': 'Release pack / publish / rollback / diff',
    'cli.cmd.refactor': 'DX rename plans / apply',
    'cli.cmd.explain': 'DX causal explain',
    'cli.cmd.plan': 'Dump frozen Rust plans via N-API',
    'cli.cmd.plan.locale': 'LocalePlan from locales/',
    'cli.cmd.plan.document-route': 'DocumentRoutePlan from documents/',
    'cli.cmd.version': 'Show host + native protocol versions',

    'cli.opt.out-dir': 'Workspace output root (default: dist)',
    'cli.opt.release': 'Release build (omit serve-host; pack minify; proof)',
    'cli.opt.profile': 'Delivery profile id',
    'cli.opt.target': 'browser | mini-program-wechat',
    'cli.opt.origin': 'Site origin for web-static',
    'cli.opt.host': 'Listen host',
    'cli.opt.port': 'Listen port',
    'cli.opt.poll-ms': 'Dev watch poll interval',
    'cli.opt.build': 'Build before serve',
    'cli.opt.check': 'Format check-only',
    'cli.opt.deny-warnings': 'Treat warnings as errors',
    'cli.opt.json': 'Write JSON to stdout or file',

    'cli.err.unknown_command': 'unknown command `{cmd}`',
    'cli.err.unknown_option': 'unknown option `{option}`',
    'cli.err.missing_option_value': 'missing value for `{option}`',
    'cli.err.unknown_plan_kind': 'unknown plan kind `{kind}` (locale | document-route)',
    'cli.err.unknown_target': 'unknown --target {target} (browser | mini-program-wechat)',
    'cli.err.project_bin_missing': 'found project `vmz` / `@vmz/vmz` but bin/vmz.js is missing.',
    'cli.err.global_needs_project':
        'this `vmz` is a global install (mode=global); project commands need a project install.',
    'cli.err.global_install_hint': 'Install in the app:  pnpm add -D @vmz/vmz',
    'cli.err.global_run_hint': 'Then run:            pnpm exec vmz <command>',
    'cli.err.global_developer_hint':
        '(developer mode: run from vmz-framework packages/runtimes/vmz source — full CLI)',

    /** Fallback when wire diagnostic has no code (args.message). */
    'diag.message': '{message}',
};

/**
 * Minimal `{arg}` substitution against a catalog table.
 */
export function translateCatalog(
    id: string,
    args: Record<string, string> | undefined,
    catalog: LocaleCatalog,
): string {
    const template = catalog[id];
    if (template == null) return `{{${id}}}`;
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name) => {
        if (args && Object.prototype.hasOwnProperty.call(args, name)) {
            return args[name] ?? '';
        }
        return `{${name}}`;
    });
}

/**
 * Build the official Localize plugin for `@vmz/vmz`.
 */
export function createVmzCliLocalize(opts: { locale?: string; catalog?: LocaleCatalog } = {}): LocalizePlugin {
    const locale = typeof opts.locale === 'string' && opts.locale ? opts.locale : 'en-US';
    const catalog = opts.catalog ?? VMZ_CLI_CATALOG_EN_US;
    return {
        resolveLocale: () => locale,
        t: (id, args) => translateCatalog(id, args, catalog),
    };
}

/** Default official plugin (`en-US`). */
export const vmzCliLocalize = createVmzCliLocalize();

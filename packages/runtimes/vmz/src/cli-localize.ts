/**
 * Official CLI / diagnostic localization for `@vmz/vmz`.
 *
 * Catalogs live here — not in `@vmz/commander`, `@vmz/diagnostic`, or a separate
 * `@vmz/i18n` package. Grow message ids as help / diagnostics migrate.
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

    'cli.help.plan': `vmz plan — dump frozen Rust plans (N-API)

Usage:
  vmz plan locale [root]            LocalePlan from locales/
  vmz plan document-route [root]    DocumentRoutePlan from documents/

Options:
  --json [file]   Write plan JSON to file (default: stdout)
`,

    'cli.err.unknown_command': 'unknown command `{cmd}`',
    'cli.err.unknown_plan_kind': 'unknown plan kind `{kind}` (locale | document-route)',
    'cli.err.unknown_target': 'unknown --target {target} (browser | mini-program-wechat)',
    'cli.err.project_bin_missing': 'found project `vmz` / `@vmz/vmz` but bin/vmz.js is missing.',
    'cli.err.global_needs_project':
        'this `vmz` is a global install (mode=global); project commands need a project install.',
    'cli.err.global_install_hint': 'Install in the app:  pnpm add -D @vmz/vmz',
    'cli.err.global_run_hint': 'Then run:            pnpm exec vmz <command>',
    'cli.err.global_developer_hint':
        '(developer mode: run from vmz-framework packages/runtimes/vmz source — full CLI)',
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

/**
 * Prefer catalog[code] when present; otherwise keep transitional wire `message`.
 */
export function renderDiagnosticMessage(
    d: { code?: string; message?: string; args?: Record<string, string> },
    localize: LocalizePlugin = vmzCliLocalize,
): string {
    const code = d.code ? String(d.code) : '';
    if (code && Object.prototype.hasOwnProperty.call(VMZ_CLI_CATALOG_EN_US, code)) {
        return localize.t(code, d.args);
    }
    if (d.message != null && String(d.message).length) return String(d.message);
    if (code) return `{{${code}}}`;
    return '';
}

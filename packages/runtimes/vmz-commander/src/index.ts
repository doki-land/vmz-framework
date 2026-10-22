/**
 * `@vmz/commander` — i18n-first TypeScript CLI framework.
 *
 * Command / option second args are message ids. Natural language comes from a
 * pluggable Localize plugin or `.locales(root)`. Framework chrome/err ids are
 * `commander.*` with tiny English fallbacks — no product language packs here.
 */

export type { CatalogLoader, CommandDiagnostic, DiagnosticContext, DiagnosticHandler, LocaleCatalog, LocalizePlugin } from './types.js';
export { CliError } from './types.js';

export {
    COMMANDER_FALLBACK_EN_US,
    clearLocalesCache,
    createLocalizeFromLocales,
    flattenCatalog,
    loadCatalog,
    loadLocalesManifest,
    resolveLocale,
    translate,
    translateWithFallback,
} from './locales.js';
export type { CreateLocalizeFromLocalesOptions, LocalesManifest } from './locales.js';

import type { CatalogLoader, CommandDiagnostic, DiagnosticContext, DiagnosticHandler, LocaleCatalog, LocalizePlugin } from './types.js';
import { CliError } from './types.js';
import { COMMANDER_FALLBACK_EN_US, createLocalizeFromLocales, translate, translateWithFallback } from './locales.js';

type Color = 'bold' | 'dim' | 'cyan' | 'blue' | 'green' | 'yellow' | 'red';
const ANSI: Record<Color, string> = {
    bold: '\u001b[1m',
    dim: '\u001b[2m',
    cyan: '\u001b[36m',
    blue: '\u001b[34m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    red: '\u001b[31m',
};
const ANSI_RESET = '\u001b[0m';

/** Keep CI and redirected output plain while making interactive help scannable. */
function colorEnabled(): boolean {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;

    // Node.js reports `isTTY` as `undefined` in many Windows shells (PowerShell,
    // Git Bash) even when the host (Windows Terminal, ConEmu, mintty) does emit
    // ANSI. `tty.isatty(fd)` is reliable on every platform because it asks the
    // OS directly. On top of that we also check well-known Windows-terminal
    // env vars (`WT_SESSION`, `ConEmuANSI`, `ANSICON`) that legacy clients use
    // to declare ANSI support. A `TERM=dumb` redirect still falls through.
    const tty = tryImportTty();
    if (tty && tty.isatty(process.stdout?.fd ?? 0)) return true;
    if (tty && tty.isatty(process.stderr?.fd ?? 2)) return true;
    if (process.env.WT_SESSION) return true;
    if (process.env.ConEmuANSI === 'ON') return true;
    if (process.env.ANSICON) return true;
    if (process.env.TERM && process.env.TERM !== 'dumb') return true;

    return Boolean(process.stdout?.isTTY || process.stderr?.isTTY);
}

/** Dynamically resolve Node's `node:tty` module — safe in non-Node runners. */
function tryImportTty(): typeof import('node:tty') | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('node:tty');
    } catch {
        return undefined;
    }
}

function paint(value: string, ...colors: Color[]): string {
    return colorEnabled() && colors.length ? `${colors.map((color) => ANSI[color]).join('')}${value}${ANSI_RESET}` : value;
}

function errorText(value: string): string {
    return paint(value, 'bold', 'red');
}

/**
 * Render one help section (header + padded table).
 *
 * Both the root help and the command-node help share the same 3-line pattern:
 * push section header (`paint(t(headerId), 'bold', 'blue')`), then a loop of
 * `  ${paint(raw.padEnd(colWidth), color)} ${t(helpId)}`.
 *
 * Returns `lines[]` so callers can spread-append without trailing-empty concerns.
 */
function renderHelpSection(
    t: LocalizePlugin['t'],
    headerId: string,
    rows: ReadonlyArray<{ rawName: string; helpId: string }>,
    color: Color,
    colWidth = 28,
): string[] {
    if (!rows.length) return [];
    const out: string[] = [paint(t(headerId), 'bold', 'blue')];
    for (const r of rows) {
        out.push(`  ${paint(r.rawName.padEnd(colWidth), color)} ${t(r.helpId)}`);
    }
    return out;
}

/** Options bag passed to actions (`_` = positionals). */
export type ParsedOptions = Record<string, string | boolean | string[]> & { _: string[] };

/** Command action after argv is parsed. */
export type ActionHandler = (options: ParsedOptions, ...args: string[]) => void | number | Promise<void | number>;

/** Registered option (structure only). */
export type OptionDef = {
    rawName: string;
    helpId: string;
    /** Canonical key in options bag (e.g. `out-dir`). */
    key: string;
    /** Long/short tokens without leading dashes (e.g. `out-dir`, `o`). */
    aliases: string[];
    /** True when the option takes a value (`<x>` / `[x]`). */
    takesValue: boolean;
    /** True when value is optional (`[x]`): bare flag ⇒ `true`. */
    optionalValue: boolean;
    /** True when the option may repeat (`--dirty <path>...` ⇒ `string[]`). */
    repeatable: boolean;
};

/** Registered command node. */
export type CommandDef = {
    rawName: string;
    helpId: string;
    /** Match tokens from `rawName` split on `|`. */
    names: string[];
    options: OptionDef[];
    action?: ActionHandler;
    children: CommandDef[];
    /** If true, do not parse options; remaining argv is positionals / raw rest. */
    passthrough: boolean;
};

export interface Command {
    option(rawName: string, helpId: string): this;
    action(handler: ActionHandler): this;
    command(rawName: string, helpId: string): Command;
    /** Leave remaining argv unparsed (for nested domain CLIs). */
    passthrough(): this;
}

export interface Cli {
    use(plugin: LocalizePlugin): this;
    catalog(loader: CatalogLoader): this;
    /**
     * Load catalogs from a locales directory (`locales.json` + `<locale>/*.json`).
     * Later `.use` overrides. Rebuilds at `parse` so `--locale` / env apply.
     */
    locales(root: string, opts?: { envKeys?: string[] }): this;
    /** Global option (parsed before the command; merged into action options). */
    option(rawName: string, helpId: string): this;
    /**
     * Optional short intro line(s) before derived command/option lists.
     * Do **not** paste full usage here — help is derived from the command tree.
     */
    intro(introId: string): this;
    /**
     * @deprecated Use {@link intro}. Kept as alias so older call sites compile.
     */
    help(helpId: string): this;
    command(rawName: string, helpId: string): Command;
    /** Route structured action failures to a product-owned renderer. */
    onDiagnostic(handler: DiagnosticHandler): this;
    parse(argv?: string[]): Promise<number>;
}

class CommandBuilder implements Command {
    readonly def: CommandDef;

    constructor(rawName: string, helpId: string) {
        assertHelpId(helpId, 'command');
        this.def = {
            rawName,
            helpId,
            names: splitNames(rawName),
            options: [],
            children: [],
            passthrough: false,
        };
    }

    option(rawName: string, helpId: string): this {
        assertHelpId(helpId, 'option');
        this.def.options.push(parseOptionDef(rawName, helpId));
        return this;
    }

    action(handler: ActionHandler): this {
        this.def.action = handler;
        return this;
    }

    passthrough(): this {
        this.def.passthrough = true;
        return this;
    }

    command(rawName: string, helpId: string): Command {
        const child = new CommandBuilder(rawName, helpId);
        this.def.children.push(child.def);
        return child;
    }
}

class CliBuilder implements Cli {
    readonly name: string;
    private localize: LocalizePlugin | null = null;
    /** When set, `parse` rebuilds localize from this root (argv/env/`--locale`). */
    private localesRoot: string | null = null;
    private localesEnvKeys: string[] | undefined;
    private diagnosticHandler: DiagnosticHandler | undefined;
    private introId: string | null = null;
    private readonly roots: CommandBuilder[] = [];
    private readonly rootOptions: OptionDef[] = [];

    constructor(name: string) {
        this.name = name;
    }

    use(plugin: LocalizePlugin): this {
        if (!plugin || typeof plugin.t !== 'function') {
            throw CliError.configError('commander::config::invalid_localize_plugin', { detail: 'LocalizePlugin.t is required' });
        }
        this.localesRoot = null;
        this.localesEnvKeys = undefined;
        this.localize = wrapWithCommanderFallback(plugin);
        return this;
    }

    catalog(loader: CatalogLoader): this {
        if (typeof loader !== 'function') {
            throw CliError.configError('commander::config::catalog_loader_not_function');
        }
        return this.use({
            t: (id, args) => {
                const table = loader('en-US');
                if (table && typeof (table as Promise<LocaleCatalog>).then === 'function') {
                    throw CliError.configError('commander::config::async_catalog_unsupported');
                }
                return translateWithFallback(id, args, table as LocaleCatalog);
            },
        });
    }

    locales(root: string, opts: { envKeys?: string[] } = {}): this {
        if (!root || typeof root !== 'string') {
            throw CliError.configError('commander::config::invalid_locales_root');
        }
        this.localesRoot = root;
        this.localesEnvKeys = opts.envKeys;
        if (!this.rootOptions.some((o) => o.key === 'locale')) {
            this.rootOptions.push(parseOptionDef('--locale <id>', 'commander.opt.locale'));
        }
        // Eager plugin so missing-manifest fails early; parse rebuilds with argv.
        this.localize = wrapWithCommanderFallback(createLocalizeFromLocales({ root, envKeys: opts.envKeys }));
        return this;
    }

    option(rawName: string, helpId: string): this {
        assertHelpId(helpId, 'option');
        this.rootOptions.push(parseOptionDef(rawName, helpId));
        return this;
    }

    intro(introId: string): this {
        assertHelpId(introId, 'intro');
        this.introId = introId;
        return this;
    }

    help(helpId: string): this {
        return this.intro(helpId);
    }

    command(rawName: string, helpId: string): Command {
        const cmd = new CommandBuilder(rawName, helpId);
        this.roots.push(cmd);
        return cmd;
    }

    onDiagnostic(handler: DiagnosticHandler): this {
        if (typeof handler !== 'function') throw CliError.configError('commander::config::diagnostic_handler_not_function');
        this.diagnosticHandler = handler;
        return this;
    }

    /** Help ids registered on this CLI (for {@link assertCatalogCoverage}). */
    collectHelpIds(): string[] {
        const ids: string[] = [];
        if (this.introId) ids.push(this.introId);
        for (const o of this.rootOptions) ids.push(o.helpId);
        const walk = (def: CommandDef) => {
            ids.push(def.helpId);
            for (const o of def.options) ids.push(o.helpId);
            for (const c of def.children) walk(c);
        };
        for (const r of this.roots) walk(r.def);
        return [...new Set(ids)];
    }

    async parse(argvInput: string[] = process.argv): Promise<number> {
        const argv0 = normalizeArgv(argvInput);
        const { options: globalOpts, rest: argv } = peelKnownOptions(argv0, this.rootOptions);

        let localize = this.localize;
        if (this.localesRoot) {
            const localeFlag = typeof globalOpts.locale === 'string' && globalOpts.locale ? globalOpts.locale : undefined;
            localize = wrapWithCommanderFallback(
                createLocalizeFromLocales({
                    root: this.localesRoot,
                    locale: localeFlag,
                    argv: argv0,
                    env: process.env,
                    envKeys: this.localesEnvKeys,
                }),
            );
        }
        if (!localize) {
            throw CliError.configError('commander::config::localize_required');
        }
        const t = localize.t.bind(localize);
        const diagnosticContext: DiagnosticContext = {
            locale: localize.resolveLocale?.({ argv: argv0, env: process.env }) ?? 'en-US',
            t,
        };

        // `help <cmd> ...` 路由：把 help 后面的 token 当命令路径查找帮助
        if (argv.length && argv[0] === 'help') {
            const pathTokens = argv.slice(1);
            return this.routeHelp(pathTokens, t, diagnosticContext);
        }

        if (argv.length === 0 || argv.every(isHelpToken)) {
            console.log(this.formatRootHelp(t));
            return 0;
        }

        const cmdToken = argv[0]!;
        const matched = this.roots.find((c) => c.def.names.includes(cmdToken));
        if (!matched) {
            // 未知命令：加上 suggestion
            const names = this.roots.flatMap((r) => r.def.names);
            const suggest = closestMatch(cmdToken, names);
            this.emitDiagnostic(
                {
                    code: 'commander::unknown_command',
                    severity: 'error',
                    args: suggest ? { cmd: cmdToken, suggest } : { cmd: cmdToken },
                },
                diagnosticContext,
                t,
            );
            return 2;
        }

        return await this.dispatch(matched.def, argv.slice(1), t, [cmdToken], globalOpts, diagnosticContext);
    }

    /** 路由 `help <cmd> [subcmd] ...` 到对应命令的帮助文本。 */
    private routeHelp(pathTokens: string[], t: LocalizePlugin['t'], _ctx: DiagnosticContext): number {
        if (!pathTokens.length) {
            console.log(this.formatRootHelp(t));
            return 0;
        }
        let pool: CommandDef[] | undefined = this.roots.map((r) => r.def);
        let matched: CommandDef | undefined;
        let consumed = 0;
        for (const tok of pathTokens) {
            const found: CommandDef | undefined = pool?.find((c) => c.names.includes(tok));
            if (!found) break;
            matched = found;
            consumed += 1;
            pool = found.children;
        }
        if (!matched) {
            // 路径里没有一个有效命令 → 仍显示根帮助
            console.log(this.formatRootHelp(t));
            return 0;
        }
        const path = pathTokens.slice(0, consumed);
        console.log(formatCommandHelp(this.name, matched, t, path, this.rootOptions));
        return 0;
    }

    /** Emit a diagnostic through `onDiagnostic` when registered, else console.error with a short hint. */
    private emitDiagnostic(
        diag: CommandDiagnostic,
        ctx: DiagnosticContext,
        _t: LocalizePlugin['t'],
    ): void {
        if (this.diagnosticHandler) {
            this.diagnosticHandler(diag, ctx);
        } else {
            const msg = diag.message ?? (_t(diag.code!, diag.args) ?? '');
            console.error(errorText(msg || diag.code || String(diag)));
            // parse/validation 错误加一行简短 hint
            if (diag.code === 'commander::unknown_command'
                || diag.code === 'commander::unknown_option'
                || diag.code === 'commander::missing_option_value'
                || diag.code === 'commander::parse_failed') {
                const path = (diag.args?.cmd ?? '').split(' ');
                const hintTarget = path.length > 1 ? path.join(' ') : this.name;
                console.error(paint(`Run '${hintTarget} --help' for available options.`, 'dim'));
            }
            // suggestion 也打印出来（没有 handler 的 fallback）
            const suggest = diag.args?.suggest;
            if (suggest) {
                console.error(paint(`Did you mean: ${suggest}`, 'dim'));
            }
        }
    }

    /** Derived root help: optional intro + commands/options from the registration tree. */
    formatRootHelp(t: LocalizePlugin['t']): string {
        const lines: string[] = [];
        if (this.introId) {
            lines.push(t(this.introId), '');
        }
        lines.push(paint(t('commander.ui.usage', { name: this.name }), 'bold', 'cyan'));
        lines.push('');
        lines.push(...renderHelpSection(
            t,
            'commander.ui.commands',
            this.roots.map((c) => ({ rawName: c.def.rawName, helpId: c.def.helpId })),
            'green',
        ));
        const opts = [
            ...this.rootOptions,
            ...collectRootOptions(this.roots.map((c) => c.def)).filter((o) => !this.rootOptions.some((r) => r.key === o.key)),
        ];
        lines.push('');
        lines.push(...renderHelpSection(
            t,
            'commander.ui.options',
            opts.map((o) => ({ rawName: o.rawName, helpId: o.helpId })),
            'yellow',
        ));
        return lines.join('\n');
    }

    private async dispatch(
        def: CommandDef,
        rest: string[],
        t: LocalizePlugin['t'],
        path: string[],
        globalOpts: ParsedOptions,
        diagnosticContext: DiagnosticContext,
    ): Promise<number> {
        // 在任何解析前先扫描 --help / -h（任何位置，跳过 -- 后面）
        if (hasHelpToken(rest)) {
            console.log(formatCommandHelp(this.name, def, t, path, this.rootOptions));
            return 0;
        }

        if (def.children.length && rest.length && !rest[0]!.startsWith('-')) {
            const childTok = rest[0]!;
            const child = def.children.find((c) => c.names.includes(childTok));
            if (child) {
                return await this.dispatch(child, rest.slice(1), t, [...path, childTok], globalOpts, diagnosticContext);
            }
            if (!def.action) {
                const childNames = def.children.flatMap((c) => c.names);
                const suggest = closestMatch(childTok, childNames);
                this.emitDiagnostic(
                    {
                        code: 'commander::unknown_command',
                        severity: 'error',
                        args: suggest ? { cmd: [...path, childTok].join(' '), suggest } : { cmd: [...path, childTok].join(' ') },
                    },
                    diagnosticContext,
                    t,
                );
                return 2;
            }
        }

        if (!def.action) {
            if (rest.length) {
                this.emitDiagnostic(
                    { code: 'commander::unknown_command', severity: 'error', args: { cmd: [...path, ...rest].join(' ') } },
                    diagnosticContext,
                    t,
                );
                return 2;
            }
            console.log(formatCommandHelp(this.name, def, t, path, this.rootOptions));
            return 0;
        }

        let options: ParsedOptions;
        try {
            options = def.passthrough ? { _: rest.slice() } : parseOptions(rest, def.options);
        } catch (err) {
            const cliErr = CliError.from(err, 'commander::parse_failed');
            this.emitDiagnostic(
                { code: cliErr.code, severity: 'error', args: cliErr.args, message: cliErr.message },
                diagnosticContext,
                t,
            );
            return cliErr.exitCode;
        }

        for (const [k, v] of Object.entries(globalOpts)) {
            if (k === '_') continue;
            if (options[k] === undefined) options[k] = v as string | boolean | string[];
        }

        try {
            const result = await def.action(options, ...options._);
            if (typeof result === 'number') return result;
            return 0;
        } catch (err) {
            const diagnostic = normalizeDiagnostic(err);
            this.emitDiagnostic(diagnostic, diagnosticContext, t);
            return 1;
        }
    }
}

/** Derive command help from one node (children + options). */
export function formatCommandHelp(
    cliName: string,
    def: CommandDef,
    t: LocalizePlugin['t'],
    path: string[],
    rootOptions: OptionDef[] = [],
): string {
    const lines: string[] = [paint(`${cliName} ${path.join(' ')}`, 'bold', 'cyan') + ` — ${t(def.helpId)}`];
    if (def.children.length) {
        lines.push('');
        lines.push(...renderHelpSection(
            t,
            'commander.ui.commands',
            def.children.map((c) => ({ rawName: c.rawName, helpId: c.helpId })),
            'green',
        ));
    }
    const opts = [...rootOptions, ...def.options.filter((o) => !rootOptions.some((r) => r.key === o.key))];
    if (opts.length) {
        lines.push('');
        lines.push(...renderHelpSection(
            t,
            'commander.ui.options',
            opts.map((o) => ({ rawName: o.rawName, helpId: o.helpId })),
            'yellow',
        ));
    }
    return lines.join('\n').trimEnd();
}

/** Union options declared on root commands (dedupe by key, stable first-seen order). */
function collectRootOptions(roots: CommandDef[]): OptionDef[] {
    const seen = new Set<string>();
    const out: OptionDef[] = [];
    for (const root of roots) {
        for (const o of root.options) {
            if (seen.has(o.key)) continue;
            seen.add(o.key);
            out.push(o);
        }
    }
    return out;
}

/**
 * Create a CLI named `name` (shown in usage).
 */
export function createCli(name: string): Cli {
    if (!name || typeof name !== 'string') {
        throw CliError.configError('commander::config::invalid_cli_name', { detail: String(name) });
    }
    return new CliBuilder(name);
}

/**
 * Dev/CI: every registered helpId must exist in `catalog` or commander English fallbacks.
 */
export function assertCatalogCoverage(cli: Cli, catalog: LocaleCatalog): void {
    const ids = typeof (cli as CliBuilder).collectHelpIds === 'function' ? (cli as CliBuilder).collectHelpIds() : [];
    const missing = ids.filter(
        (id) => !Object.prototype.hasOwnProperty.call(catalog, id) && !Object.prototype.hasOwnProperty.call(COMMANDER_FALLBACK_EN_US, id),
    );
    if (missing.length) {
        throw CliError.configError('commander::config::catalog_missing_help_ids', { ids: missing.sort().join(', ') });
    }
}

function wrapWithCommanderFallback(plugin: LocalizePlugin): LocalizePlugin {
    return {
        resolveLocale: plugin.resolveLocale?.bind(plugin),
        t: (id, args) => {
            const fromPlugin = plugin.t(id, args);
            if (fromPlugin !== `{{${id}}}`) return fromPlugin;
            if (Object.prototype.hasOwnProperty.call(COMMANDER_FALLBACK_EN_US, id)) {
                return translate(id, args, COMMANDER_FALLBACK_EN_US);
            }
            return fromPlugin;
        },
    };
}

/**
 * Shared argv → { options, rest } parser used by both strict and permissive modes.
 *
 * - `strict: true` — throws {@link CliError} (exit code 2) on unknown option or
 *   missing required value. Used by {@link parseOptions} before dispatching to an action.
 * - `strict: false` — unknown flags / bare tokens stay in `rest`. Used by
 *   {@link peelKnownOptions} so `.locales(root)` / other early-bound global options
 *   never reject argv that belongs to a later subcommand.
 */
function parseArgvCore(
    argv: string[],
    optionDefs: OptionDef[],
    strict: boolean,
): { options: ParsedOptions; rest: string[] } {
    const byAlias = new Map<string, OptionDef>();
    for (const def of optionDefs) {
        for (const a of def.aliases) byAlias.set(a, def);
    }
    const options: ParsedOptions = { _: [] };
    const rest: string[] = [];

    const handleMissing = (flagName: string) => {
        if (strict) {
            throw CliError.parseError('commander::missing_option_value', { option: flagName });
        }
        rest.push(flagName);
        return true;
    };
    const handleUnknown = (token: string): boolean => {
        if (strict) {
            throw CliError.parseError('commander::unknown_option', { option: token });
        }
        rest.push(token);
        return true;
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === '--') {
            // 消费 -- 分隔符本身，后面的原样进 positional
            rest.push(...argv.slice(i + 1));
            break;
        }
        if (isHelpToken(a)) {
            // 框架级保留：--help / -h 不进 options 也不进 rest，让上层 dispatch 处理
            continue;
        }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            const long = eq === -1 ? a.slice(2) : a.slice(2, eq);
            const def = byAlias.get(long);
            if (!def) {
                if (!handleUnknown(`--${long}`)) continue;
                continue;
            }
            if (def.takesValue) {
                if (eq !== -1) {
                    assignOption(options, def, a.slice(eq + 1));
                } else {
                    const next = argv[i + 1];
                    if (next != null && !next.startsWith('-')) {
                        assignOption(options, def, next);
                        i += 1;
                    } else if (def.optionalValue) {
                        assignOption(options, def, true);
                    } else {
                        if (!handleMissing(`--${long}`)) continue;
                        continue;
                    }
                }
            } else {
                assignOption(options, def, true);
            }
            continue;
        }
        // 短参数：-x 或 -xyz（多字符），只要不以 -- 开头且以 - 开头且长度 > 1 就认作短选项
        if (a.startsWith('-') && a.length > 1) {
            const short = a.slice(1);
            const def = byAlias.get(short);
            if (!def) {
                if (!handleUnknown(`-${short}`)) continue;
                continue;
            }
            if (def.takesValue) {
                const next = argv[i + 1];
                if (next != null && !next.startsWith('-')) {
                    assignOption(options, def, next);
                    i += 1;
                } else if (def.optionalValue) {
                    assignOption(options, def, true);
                } else {
                    if (!handleMissing(`-${short}`)) continue;
                    continue;
                }
            } else {
                assignOption(options, def, true);
            }
            continue;
        }
        rest.push(a);
    }
    return { options, rest };
}

/**
 * Consume known root options; leave unknown flags and positionals in `rest`
 * (unlike {@link parseOptions}, which throws on unknown options).
 */
export function peelKnownOptions(argv: string[], optionDefs: OptionDef[]): { options: ParsedOptions; rest: string[] } {
    return parseArgvCore(argv, optionDefs, false);
}

/** Strip `node` + script when callers pass full `process.argv`. */
export function normalizeArgv(argv: string[]): string[] {
    if (argv.length >= 2 && looksLikeNode(argv[0]!) && looksLikeScript(argv[1]!)) {
        return argv.slice(2);
    }
    return argv.slice();
}

function looksLikeNode(token: string): boolean {
    const base = token.replace(/\\/g, '/').split('/').pop() || '';
    return base === 'node' || base === 'node.exe' || base.startsWith('node');
}

function looksLikeScript(token: string): boolean {
    return /\.(c?js|mjs|ts)$/i.test(token) || token.includes(`${'node_modules'}`) || token.endsWith('vmz');
}

function isHelpToken(token: string): boolean {
    return token === 'help' || token === '-h' || token === '--help';
}

function splitNames(rawName: string): string[] {
    return rawName
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
}

function assertHelpId(helpId: string, kind: string): void {
    if (!helpId || typeof helpId !== 'string' || !helpId.trim()) {
        throw CliError.configError('commander::config::help_id_empty', { kind });
    }
    if (/\s/.test(helpId)) {
        throw CliError.configError('commander::config::help_id_has_spaces', { kind, id: helpId });
    }
}

/** Parse `--out-dir <dir>` / `-o, --out-dir <dir>` / `--dirty <path>...` into an OptionDef. */
export function parseOptionDef(rawName: string, helpId: string): OptionDef {
    const repeatable = /\.\.\.\s*$/.test(rawName) || /\.\.\.>/.test(rawName) || /\.\.\.]/.test(rawName);
    const optionalValue = /\[[^\]]+\]/.test(rawName);
    const takesValue = optionalValue || /<[^>]+>/.test(rawName) || repeatable;
    const cleaned = rawName
        .replace(/\.\.\./g, '')
        .replace(/<[^>]+>|\[[^\]]+\]/g, '')
        .trim();
    const parts = cleaned
        .split(/[,\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    const aliases: string[] = [];
    for (const p of parts) {
        if (p.startsWith('--')) aliases.push(p.slice(2));
        else if (p.startsWith('-') && p.length > 1) aliases.push(p.slice(1));
    }
    if (!aliases.length) {
        throw CliError.configError('commander::config::invalid_option_raw', { raw: rawName });
    }
    const key = aliases.find((a) => a.length > 1) ?? aliases[0]!;
    return { rawName, helpId, key, aliases, takesValue, optionalValue, repeatable };
}

function normalizeDiagnostic(error: unknown): CommandDiagnostic {
    if (error && typeof error === 'object') {
        const value = error as Record<string, unknown>;
        const candidate = value.diagnostic && typeof value.diagnostic === 'object' ? value.diagnostic as Record<string, unknown> : value;
        if (typeof candidate.code === 'string' || typeof candidate.severity === 'string' || typeof candidate.path === 'string') {
            return {
                code: typeof candidate.code === 'string' ? candidate.code : undefined,
                severity: typeof candidate.severity === 'string' ? candidate.severity : 'error',
                args: candidate.args && typeof candidate.args === 'object' ? candidate.args as Record<string, string> : undefined,
                path: typeof candidate.path === 'string' ? candidate.path : undefined,
                span: candidate.span && typeof candidate.span === 'object' ? candidate.span as { start: number; end: number } : undefined,
                message: typeof candidate.message === 'string' ? candidate.message : undefined,
            };
        }
    }
    const text = error instanceof Error ? error.message : String(error);
    // 同时放 message 和 detail：不同产品 catalog 模板可能用 {message} 或 {detail}
    return { severity: 'error', code: 'commander::action_failed', args: { message: text, detail: text }, message: text };
}

/**
 * Parse argv against registered options (strict mode).
 *
 * Throws {@link CliError} with stable code `commander::unknown_option` /
 * `commander::missing_option_value` (exit code 2) on validation failure.
 * Non-option tokens become positionals under `options._`.
 */
export function parseOptions(argv: string[], optionDefs: OptionDef[]): ParsedOptions {
    const { options, rest } = parseArgvCore(argv, optionDefs, true);
    options._.push(...rest);
    return options;
}

function assignOption(out: ParsedOptions, def: OptionDef, value: string | boolean): void {
    if (def.repeatable) {
        const cur = out[def.key];
        const list = Array.isArray(cur) ? cur : [];
        list.push(String(value));
        out[def.key] = list;
        return;
    }
    out[def.key] = value;
}

/** 扫描 argv 是否包含 help token（跳过 -- 后面的内容）。 */
function hasHelpToken(argv: string[]): boolean {
    for (const tok of argv) {
        if (tok === '--') return false;
        if (isHelpToken(tok)) return true;
    }
    return false;
}

/**
 * 简单 Levenshtein 距离：找最接近的候选字符串。
 * 返回值是建议的命令名（可能有多个用逗号连接），找不到返回空字符串。
 */
function closestMatch(input: string, candidates: string[]): string {
    if (!input || !candidates.length) return '';
    const lower = input.toLowerCase();
    let best: { name: string; dist: number }[] = [];
    for (const c of candidates) {
        const d = levenshtein(lower, c.toLowerCase());
        // 只接受距离 ≤ 3 且不超过输入长度 60% 的候选，避免把完全不相关的命令也建议出来
        const threshold = Math.max(2, Math.floor(input.length * 0.6) + 1);
        if (d <= threshold) {
            best.push({ name: c, dist: d });
        }
    }
    if (!best.length) return '';
    best.sort((a, b) => a.dist - b.dist);
    // 最多返回前 3 个
    return best.slice(0, 3).map((b) => b.name).join(', ');
}

function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    // 只维护两行，节省内存
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n]!;
}

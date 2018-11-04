/**
 * `@vmz/commander` — TypeScript CLI framework.
 *
 * Command / option second args are message ids. Natural language comes from a
 * pluggable Localize plugin (official catalogs live in `@vmz/vmz`, not here).
 */

/** Message id → template. Owned by the localize plugin / product, not this package. */
export type LocaleCatalog = Record<string, string>;

/** Load messages for one locale (sugar for building a {@link LocalizePlugin}). */
export type CatalogLoader = (locale: string) => LocaleCatalog | Promise<LocaleCatalog>;

/**
 * Pluggable localization. Products and end users supply their own `t` / locale policy.
 * This package never ships official language packs.
 */
export type LocalizePlugin = {
    resolveLocale?: (ctx: { argv: string[]; env: NodeJS.ProcessEnv }) => string;
    t: (id: string, args?: Record<string, string>) => string;
};

/** Options bag passed to actions (`_` = positionals). */
export type ParsedOptions = Record<string, string | boolean | string[]> & { _: string[] };

/** Command action after argv is parsed. */
export type ActionHandler = (
    options: ParsedOptions,
    ...args: string[]
) => void | number | Promise<void | number>;

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
    /** Root help banner message id (printed for `help` / `-h` / no args). */
    help(helpId: string): this;
    command(rawName: string, helpId: string): Command;
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
    private rootHelpId: string | null = null;
    private readonly roots: CommandBuilder[] = [];

    constructor(name: string) {
        this.name = name;
    }

    use(plugin: LocalizePlugin): this {
        if (!plugin || typeof plugin.t !== 'function') {
            throw new Error('@vmz/commander: LocalizePlugin.t is required');
        }
        this.localize = plugin;
        return this;
    }

    catalog(loader: CatalogLoader): this {
        if (typeof loader !== 'function') {
            throw new Error('@vmz/commander: catalog(loader) requires a function');
        }
        return this.use({
            t: (id, args) => {
                const table = loader('en-US');
                if (table && typeof (table as Promise<LocaleCatalog>).then === 'function') {
                    throw new Error(
                        '@vmz/commander: async CatalogLoader via .catalog() is not supported; use .use({ t })',
                    );
                }
                return substitute((table as LocaleCatalog)[id], id, args);
            },
        });
    }

    help(helpId: string): this {
        assertHelpId(helpId, 'help');
        this.rootHelpId = helpId;
        return this;
    }

    command(rawName: string, helpId: string): Command {
        const cmd = new CommandBuilder(rawName, helpId);
        this.roots.push(cmd);
        return cmd;
    }

    async parse(argvInput: string[] = process.argv): Promise<number> {
        const localize = this.localize;
        if (!localize) {
            throw new Error('@vmz/commander: call .use(LocalizePlugin) before parse()');
        }
        const t = localize.t.bind(localize);
        const argv = normalizeArgv(argvInput);

        if (argv.length === 0 || isHelpToken(argv[0]!)) {
            this.printRootHelp(t);
            return 0;
        }

        const cmdToken = argv[0]!;
        const matched = this.roots.find((c) => c.def.names.includes(cmdToken));
        if (!matched) {
            console.error(t('cli.err.unknown_command', { cmd: cmdToken }));
            this.printRootHelp(t);
            return 1;
        }

        return await this.dispatch(matched.def, argv.slice(1), t, [cmdToken]);
    }

    private printRootHelp(t: LocalizePlugin['t']): void {
        if (this.rootHelpId) {
            console.log(t(this.rootHelpId));
            return;
        }
        const lines = [`${this.name}`, '', 'Commands:'];
        for (const c of this.roots) {
            lines.push(`  ${c.def.rawName.padEnd(24)} ${t(c.def.helpId)}`);
        }
        console.log(lines.join('\n'));
    }

    private async dispatch(
        def: CommandDef,
        rest: string[],
        t: LocalizePlugin['t'],
        path: string[],
    ): Promise<number> {
        if (rest.length && isHelpToken(rest[0]!)) {
            this.printCommandHelp(def, t, path);
            return 0;
        }

        if (def.children.length && rest.length && !rest[0]!.startsWith('-')) {
            const childTok = rest[0]!;
            const child = def.children.find((c) => c.names.includes(childTok));
            if (child) {
                return await this.dispatch(child, rest.slice(1), t, [...path, childTok]);
            }
            if (!def.action) {
                console.error(t('cli.err.unknown_command', { cmd: [...path, childTok].join(' ') }));
                this.printCommandHelp(def, t, path);
                return 1;
            }
        }

        if (!def.action) {
            this.printCommandHelp(def, t, path);
            return rest.length ? 1 : 0;
        }

        let options: ParsedOptions;
        try {
            options = def.passthrough
                ? { _: rest.slice() }
                : parseOptions(rest, def.options);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.startsWith('unknown_option:')) {
                console.error(t('cli.err.unknown_option', { option: msg.slice('unknown_option:'.length) }));
            } else if (msg.startsWith('missing_value:')) {
                console.error(t('cli.err.missing_option_value', { option: msg.slice('missing_value:'.length) }));
            } else {
                console.error(msg);
            }
            this.printCommandHelp(def, t, path);
            return 1;
        }

        const result = await def.action(options, ...options._);
        if (typeof result === 'number') return result;
        return 0;
    }

    private printCommandHelp(def: CommandDef, t: LocalizePlugin['t'], path: string[]): void {
        const lines = [`${this.name} ${path.join(' ')} — ${t(def.helpId)}`, ''];
        if (def.children.length) {
            lines.push('Commands:');
            for (const c of def.children) {
                lines.push(`  ${c.rawName.padEnd(24)} ${t(c.helpId)}`);
            }
            lines.push('');
        }
        if (def.options.length) {
            lines.push('Options:');
            for (const o of def.options) {
                lines.push(`  ${o.rawName.padEnd(28)} ${t(o.helpId)}`);
            }
        }
        console.log(lines.join('\n').trimEnd());
    }
}

/**
 * Create a CLI named `name` (shown in usage).
 */
export function createCli(name: string): Cli {
    if (!name || typeof name !== 'string') {
        throw new Error('@vmz/commander: createCli(name) requires a non-empty program name');
    }
    return new CliBuilder(name);
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
        throw new Error(`@vmz/commander: ${kind} helpId must be a non-empty catalog key`);
    }
    if (/\s/.test(helpId)) {
        throw new Error(
            `@vmz/commander: ${kind} helpId must be a catalog key (no spaces); got ${JSON.stringify(helpId)}`,
        );
    }
}

function substitute(
    template: string | undefined,
    id: string,
    args: Record<string, string> | undefined,
): string {
    if (template == null) return `{{${id}}}`;
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name: string) => {
        if (args && Object.prototype.hasOwnProperty.call(args, name)) {
            return args[name] ?? '';
        }
        return `{${name}}`;
    });
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
        throw new Error(`@vmz/commander: invalid option rawName ${JSON.stringify(rawName)}`);
    }
    const key = aliases.find((a) => a.length > 1) ?? aliases[0]!;
    return { rawName, helpId, key, aliases, takesValue, optionalValue, repeatable };
}

/**
 * Parse argv against registered options. Throws `unknown_option:…` / `missing_value:…`.
 */
export function parseOptions(argv: string[], optionDefs: OptionDef[]): ParsedOptions {
    const byAlias = new Map<string, OptionDef>();
    for (const def of optionDefs) {
        for (const a of def.aliases) byAlias.set(a, def);
    }
    const out: ParsedOptions = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === '--') {
            out._.push(...argv.slice(i + 1));
            break;
        }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            const long = eq === -1 ? a.slice(2) : a.slice(2, eq);
            const def = byAlias.get(long);
            if (!def) throw new Error(`unknown_option:--${long}`);
            if (def.takesValue) {
                if (eq !== -1) {
                    assignOption(out, def, a.slice(eq + 1));
                } else {
                    const next = argv[i + 1];
                    if (next != null && !next.startsWith('-')) {
                        assignOption(out, def, next);
                        i += 1;
                    } else if (def.optionalValue) {
                        assignOption(out, def, true);
                    } else {
                        throw new Error(`missing_value:--${long}`);
                    }
                }
            } else {
                assignOption(out, def, true);
            }
            continue;
        }
        if (a.startsWith('-') && a.length === 2) {
            const short = a.slice(1);
            const def = byAlias.get(short);
            if (!def) throw new Error(`unknown_option:-${short}`);
            if (def.takesValue) {
                const next = argv[i + 1];
                if (next != null && !next.startsWith('-')) {
                    assignOption(out, def, next);
                    i += 1;
                } else if (def.optionalValue) {
                    assignOption(out, def, true);
                } else {
                    throw new Error(`missing_value:-${short}`);
                }
            } else {
                assignOption(out, def, true);
            }
            continue;
        }
        out._.push(a);
    }
    return out;
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

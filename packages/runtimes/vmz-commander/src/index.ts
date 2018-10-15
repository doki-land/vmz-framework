/**
 * `@vmz/commander` — TypeScript CLI framework (skeleton).
 *
 * Command / option second args are message ids. Natural language comes from a
 * pluggable Localize plugin (official catalogs live in `@vmz/vmz`, not here).
 * Implement parse / help only when `@vmz/vmz` actually migrates onto this API.
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
    /** Optional locale picker; skeleton stores it but does not invoke it yet. */
    resolveLocale?: (ctx: { argv: string[]; env: NodeJS.ProcessEnv }) => string;
    /** Translate a message id; required before product help can render. */
    t: (id: string, args?: Record<string, string>) => string;
};

/** Command action after argv is parsed. */
export type ActionHandler = (options: Record<string, unknown>, ...args: string[]) => void | number | Promise<void | number>;

/** Registered option (structure only). */
export type OptionDef = {
    rawName: string;
    helpId: string;
};

/** Registered command node (structure only). */
export type CommandDef = {
    rawName: string;
    helpId: string;
    options: OptionDef[];
    action?: ActionHandler;
    children: CommandDef[];
};

/**
 * Fluent command builder.
 * Second argument to `command` / `option` is a **catalog id**, not user-facing prose.
 */
export interface Command {
    option(rawName: string, helpId: string): this;
    action(handler: ActionHandler): this;
    command(rawName: string, helpId: string): Command;
}

/** Root CLI builder. */
export interface Cli {
    /**
     * Install localization (pluggable). Official `@vmz/vmz` catalogs plug in here;
     * third parties may substitute their own plugin.
     */
    use(plugin: LocalizePlugin): this;
    /**
     * Sugar: wrap a catalog loader as a {@link LocalizePlugin}.
     * Prefer `.use` for products that already own `t`.
     */
    catalog(loader: CatalogLoader): this;
    command(rawName: string, helpId: string): Command;
    /** Parse argv and run the matched action. Skeleton: always throws. */
    parse(argv?: string[]): Promise<number>;
}

class CommandBuilder implements Command {
    readonly def: CommandDef;

    constructor(rawName: string, helpId: string) {
        this.def = { rawName, helpId, options: [], children: [] };
    }

    option(rawName: string, helpId: string): this {
        assertHelpId(helpId, 'option');
        this.def.options.push({ rawName, helpId });
        return this;
    }

    action(handler: ActionHandler): this {
        this.def.action = handler;
        return this;
    }

    command(rawName: string, helpId: string): Command {
        assertHelpId(helpId, 'command');
        const child = new CommandBuilder(rawName, helpId);
        this.def.children.push(child.def);
        return child;
    }
}

class CliBuilder implements Cli {
    readonly name: string;
    private localize: LocalizePlugin | null = null;
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
                const locale = 'en-US';
                const table = loader(locale);
                if (table && typeof (table as Promise<LocaleCatalog>).then === 'function') {
                    throw new Error('@vmz/commander: async CatalogLoader via .catalog() is not supported in the skeleton; use .use({ t })');
                }
                const catalog = table as LocaleCatalog;
                const template = catalog[id];
                if (template == null) return `{{${id}}}`;
                return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name: string) => {
                    if (args && Object.prototype.hasOwnProperty.call(args, name)) {
                        return args[name] ?? '';
                    }
                    return `{${name}}`;
                });
            },
        });
    }

    command(rawName: string, helpId: string): Command {
        assertHelpId(helpId, 'command');
        const cmd = new CommandBuilder(rawName, helpId);
        this.roots.push(cmd);
        return cmd;
    }

    async parse(_argv: string[] = process.argv): Promise<number> {
        void this.localize;
        void this.roots;
        throw new Error(`@vmz/commander: parse() is not implemented yet (cli=${JSON.stringify(this.name)}; skeleton only)`);
    }
}

/**
 * Create a CLI named `name` (shown in usage once help lands).
 * @param name Binary / program name, e.g. `vmz`
 */
export function createCli(name: string): Cli {
    if (!name || typeof name !== 'string') {
        throw new Error('@vmz/commander: createCli(name) requires a non-empty program name');
    }
    return new CliBuilder(name);
}

/** Reject empty / prose-looking help ids early (skeleton guard). */
function assertHelpId(helpId: string, kind: string): void {
    if (!helpId || typeof helpId !== 'string' || !helpId.trim()) {
        throw new Error(`@vmz/commander: ${kind} helpId must be a non-empty catalog key`);
    }
    if (/\s/.test(helpId)) {
        throw new Error(`@vmz/commander: ${kind} helpId must be a catalog key (no spaces); got ${JSON.stringify(helpId)}`);
    }
}

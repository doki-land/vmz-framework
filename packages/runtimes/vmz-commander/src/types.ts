/**
 * Shared types for `@vmz/commander` (kept separate so locales.ts can import without cycles).
 */

/** Message id → template. Owned by the localize plugin / product, not this package. */
export type LocaleCatalog = Record<string, string>;

/** Load messages for one locale (sugar for building a {@link LocalizePlugin}). */
export type CatalogLoader = (locale: string) => LocaleCatalog | Promise<LocaleCatalog>;

/**
 * Pluggable localization. Products and end users supply their own `t` / locale policy.
 * This package never ships official product language packs.
 */
export type LocalizePlugin = {
    resolveLocale?: (ctx: { argv: string[]; env: NodeJS.ProcessEnv }) => string;
    t: (id: string, args?: Record<string, string>) => string;
};

/** Language-neutral diagnostic row accepted at a command boundary. */
export type CommandDiagnostic = {
    severity?: 'error' | 'warning' | 'advice' | string;
    code?: string;
    args?: Record<string, string>;
    path?: string;
    span?: { start: number; end: number };
    message?: string;
};

/** Product-owned sink. Formatting remains in the product diagnostic package. */
export type DiagnosticContext = { locale: string; t: LocalizePlugin['t'] };

/** Product-owned sink. Formatting remains outside commander. */
export type DiagnosticHandler = (diagnostic: CommandDiagnostic, context: DiagnosticContext) => void;

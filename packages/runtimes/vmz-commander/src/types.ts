/**
 * Shared types for `@vmz/commander` (kept separate so locales.ts can import without cycles).
 */

/**
 * Structured error thrown by `@vmz/commander` itself.
 *
 * Exit code contract (POSIX CLI conventions):
 * - 2: parse / validation failure (unknown command, unknown/missing option).
 * - 1: config / factory / action-handler failure.
 */
export class CliError extends Error {
    /** Stable code (`commander::*`) consumed by callers; also doubles as catalog id. */
    readonly code: string;
    /** Exit code a framework user should return for this failure. */
    readonly exitCode: number;
    /** Structured catalog args (`{ name: value }`) for message interpolation. */
    readonly args: Record<string, string>;
    /** Optional root cause. */
    readonly cause?: unknown;

    private constructor(opts: { code: string; exitCode: number; args?: Record<string, string>; cause?: unknown }) {
        super(opts.cause instanceof Error ? opts.cause.message : opts.code);
        this.name = 'CliError';
        this.code = opts.code;
        this.exitCode = opts.exitCode;
        this.args = opts.args ?? {};
        this.cause = opts.cause;
    }

    /** Parse / validation failures (exit code 2). */
    static parseError(code: string, args: Record<string, string> = {}): CliError {
        return new CliError({ code, exitCode: 2, args });
    }

    /** Factory / configuration failures (exit code 1). */
    static configError(code: string, args: Record<string, string> = {}): CliError {
        return new CliError({ code, exitCode: 1, args });
    }

    /** Wrap an arbitrary exception as a CliError (exit code 1). */
    static from(err: unknown, fallbackCode = 'commander::action_failed'): CliError {
        if (err instanceof CliError) return err;
        const message = err instanceof Error ? err.message : String(err);
        return new CliError({ code: fallbackCode, exitCode: 1, cause: err, args: { detail: message } });
    }
}

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

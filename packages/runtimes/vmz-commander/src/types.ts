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
        // 同时放 message 和 detail：不同产品 catalog 模板可能用 {message} 或 {detail}
        return new CliError({ code: fallbackCode, exitCode: 1, cause: err, args: { detail: message, message } });
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

/**
 * Option registration config (additive — `.option(rawName, helpId, config?)`).
 *
 * Existing `parseOptionDef(rawName)` already extracts `<required>` / `[optional]` / `...repeatable`
 * from the raw name string. This config adds runtime constraints that cannot be expressed in the DSL.
 */
export type OptionConfig = {
    /** 默认值（不传时 options[key] = default） */
    default?: string | boolean | string[];
    /** 允许值集合；parse 时 strict 校验（失败 exit code 2） */
    enum?: string[];
    /** 是否必须（parse 时缺失 → CliError，exit code 2） */
    required?: boolean;
    /** 自定义转换（parse 后对值执行，coerce 失败 → CliError.exitCode 2） */
    coerce?: (raw: string | boolean | string[]) => unknown;
    /** 帮助文本中的简短示例（显示在 `--profile <name>` 后） */
    example?: string;
    /** 选项分组（帮助里的 section header） */
    group?: string;
    /** 标记 deprecated — 帮助里划线显示，调用时走 warn */
    deprecated?: boolean | string;
    /** 标记 hidden — 不显示在帮助（但仍可解析） */
    hidden?: boolean;
};

/**
 * Command action context — constructed by the framework before dispatching to `.actionCtx()`.
 *
 * Provides everything a command handler needs without re-parsing argv or re-discovering
 * product internals. Error paths (`fail` / `warn` / `note`) route through the configured
 * DiagnosticHandler (or stderr fallback) so downstream code never needs ad-hoc `console.error`.
 */
export type CommandContext = {
    /** 完整命令路径（根命令在 [0]）— e.g. `['vmz', 'application', 'check']` */
    commandPath: string[];
    /** 命令路径的人类可读串 — e.g. `'vmz application check'` */
    commandName: string;
    /** 当前 locale id — e.g. `'en-US'` */
    locale: string;
    /** 产品 LocalizePlugin.t — action 可以用它渲染 helpId / 错误 id */
    t: LocalizePlugin['t'];
    /** 打印当前命令的帮助文本（框架级，从 command tree 自动派生） */
    help: () => void;
    /** 写入 stderr（正常错误输出） */
    stderr: (...msgs: string[]) => void;
    /** 写入 stdout（正常进度 / 结果输出） */
    stdout: (...msgs: string[]) => void;
    /** 框架级 fail：走 onDiagnostic + 退出码 2（parse/validation 错误） */
    fail: (code: string, args?: Record<string, string>) => never;
    /** 框架级 warn：走 onDiagnostic（warning severity，不退出） */
    warn: (code: string, args?: Record<string, string>) => void;
    /** 框架级 note：走 onDiagnostic（advice severity，不退出） */
    note: (code: string, args?: Record<string, string>) => void;
};

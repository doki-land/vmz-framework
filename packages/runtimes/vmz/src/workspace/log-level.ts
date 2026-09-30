/**
 * CLI output verbosity for diagnostics and progress lines.
 *
 * `error` — errors only
 * `warn`  — errors + warnings (default)
 * `info`  — errors + warnings + advice, plus progress lines
 */

export type CliLogLevel = 'error' | 'warn' | 'info';

const LEVEL_RANK: Record<CliLogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
};

let currentLevel: CliLogLevel = 'warn';

/** Active CLI log level (default `warn`). */
export function getCliLogLevel(): CliLogLevel {
    return currentLevel;
}

/** Set active CLI log level for the current command invocation. */
export function setCliLogLevel(level: CliLogLevel): void {
    currentLevel = level;
}

/** Parse `--level` values; `null` when unrecognized. */
export function parseCliLogLevel(raw: unknown): CliLogLevel | null {
    if (raw == null || raw === '') return 'warn';
    const s = String(raw).trim().toLowerCase();
    if (s === 'error') return 'error';
    if (s === 'warn' || s === 'warning') return 'warn';
    if (s === 'info' || s === 'advice') return 'info';
    return null;
}

/** Resolve level from `check` / `lint` flags (`--info` overrides `--level`). */
export function resolveCliLogLevel(args: { level?: unknown; info?: boolean }): CliLogLevel | null {
    if (args.info) return 'info';
    return parseCliLogLevel(args.level);
}

function normalizeDiagnosticSeverity(severity: string | undefined): 'error' | 'warning' | 'advice' {
    if (severity === 'warning') return 'warning';
    if (severity === 'advice') return 'advice';
    return 'error';
}

/** Whether a diagnostic severity should be printed at `level`. */
export function diagnosticVisible(severity: string | undefined, level: CliLogLevel): boolean {
    const sev = normalizeDiagnosticSeverity(severity);
    if (sev === 'error') return true;
    if (sev === 'warning') return LEVEL_RANK[level] >= LEVEL_RANK.warn;
    return LEVEL_RANK[level] >= LEVEL_RANK.info;
}

/** Progress / summary lines (`log.info`) only at `info`. */
export function progressVisible(level: CliLogLevel): boolean {
    return level === 'info';
}

/** Non-diagnostic warn lines at `warn` and above. */
export function warnVisible(level: CliLogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK.warn;
}

/**
 * Unified CLI logging / diagnostics via `@vmz/diagnostic` + product catalog.
 */

import { formatDiagnostic } from '@vmz/diagnostic';
import { loadCliCatalog, resolveVmzLocale, vmzCliLocalize } from '../cli/cli-localize.js';
import { positionContextForSource, readDiagnosticSource } from './diagnostic-context.js';
import { type CliLogLevel, diagnosticVisible, getCliLogLevel, progressVisible, warnVisible } from './log-level.js';
import { getCliLogStyle } from './log-style.js';

function normalizeSeverity(severity: string | undefined): 'error' | 'warning' | 'advice' {
    if (severity === 'warning') return 'warning';
    if (severity === 'advice') return 'advice';
    return 'error';
}

export type DiagnosticLike = {
    severity?: string;
    path?: string;
    message?: string;
    code?: string;
    args?: Record<string, string>;
    span?: { start: number; end: number };
};

export type DiagnosticLogOptions = {
    denyWarnings?: boolean;
    level?: CliLogLevel;
};

export const log = {
    info(...args: unknown[]): void {
        if (!progressVisible(getCliLogLevel())) return;
        console.error(...args);
    },
    warn(...args: unknown[]): void {
        if (!warnVisible(getCliLogLevel())) return;
        console.error(...args);
    },
    error(...args: unknown[]): void {
        console.error(...args);
    },
    /** Localized framework error (`cli.err.*`). */
    errorId(id: string, args?: Record<string, string>): void {
        console.error(vmzCliLocalize.t(id, args));
    },
    diagnostic(d: DiagnosticLike, opts: { level?: CliLogLevel } = {}): boolean {
        const level = opts.level ?? getCliLogLevel();
        const severity = normalizeSeverity(d.severity);
        if (!diagnosticVisible(severity, level)) return false;
        const hasCode = Boolean(d.code && String(d.code).length);
        const code = hasCode ? String(d.code) : 'diag.message';
        const locale = resolveVmzLocale();
        const catalog = loadCliCatalog(locale);
        const path = d.path || '';
        const style = getCliLogStyle();
        const sourceText = style === 'pretty' && path ? readDiagnosticSource(path) : undefined;
        const line = formatDiagnostic(
            {
                path,
                severity,
                code,
                args: d.args ?? (!hasCode && d.message ? { message: String(d.message) } : undefined),
                message: d.message,
                span: d.span,
            },
            {
                locale,
                catalog,
                sourceText,
                position: sourceText ? positionContextForSource(path, sourceText) : undefined,
                style,
            },
        );
        console.error(line);
        return true;
    },
    /** Failing count: errors, and warnings when `denyWarnings` (independent of print level). */
    diagnostics(diagnostics: DiagnosticLike[] | null | undefined, opts: DiagnosticLogOptions = {}): number {
        const level = opts.level ?? getCliLogLevel();
        const style = getCliLogStyle();
        let failing = 0;
        const items = diagnostics ?? [];
        const visible = items.filter((d) => diagnosticVisible(normalizeSeverity(d.severity), level));
        for (let i = 0; i < visible.length; i += 1) {
            this.diagnostic(visible[i]!, { level });
            if (style === 'pretty' && i + 1 < visible.length) console.error('');
        }
        for (const d of items) {
            if (d.severity === 'error') failing += 1;
            else if (opts.denyWarnings && d.severity === 'warning') failing += 1;
        }
        return failing;
    },
};

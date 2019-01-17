/**
 * Unified CLI logging / diagnostics via `@vmz/diagnostic` + product catalog.
 */

import { formatDiagnostic } from '@vmz/diagnostic';
import { loadCliCatalog, resolveVmzLocale, vmzCliLocalize } from '../cli/cli-localize.js';

export type DiagnosticLike = {
    severity?: string;
    path?: string;
    message?: string;
    code?: string;
    args?: Record<string, string>;
    span?: { start: number; end: number };
};

function stamp(level: string): string {
    return `vmz ${level}`;
}

export const log = {
    info(...args: unknown[]): void {
        console.error(stamp('info'), ...args);
    },
    warn(...args: unknown[]): void {
        console.error(stamp('warn'), ...args);
    },
    error(...args: unknown[]): void {
        console.error(stamp('error'), ...args);
    },
    /** Localized framework error (`cli.err.*`). */
    errorId(id: string, args?: Record<string, string>): void {
        console.error(stamp('error'), vmzCliLocalize.t(id, args));
    },
    diagnostic(d: DiagnosticLike): void {
        const severity = d.severity === 'warning' || d.severity === 'advice' || d.severity === 'error' ? d.severity : 'error';
        // Only invent transitional `diag.message` when wire has no code; never remap a real code.
        const hasCode = Boolean(d.code && String(d.code).length);
        const code = hasCode ? String(d.code) : 'diag.message';
        const locale = resolveVmzLocale();
        const catalog = loadCliCatalog(locale);
        const line = formatDiagnostic(
            {
                path: d.path || '',
                severity,
                code,
                args: d.args ?? (!hasCode && d.message ? { message: String(d.message) } : undefined),
                message: d.message,
                span: d.span,
            },
            {
                locale,
                catalog,
            },
        );
        console.error(stamp(severity === 'warning' ? 'warn' : severity === 'error' ? 'error' : 'diag'), line);
    },
    /** Failing count: errors, and warnings when `denyWarnings`. */
    diagnostics(diagnostics: DiagnosticLike[] | null | undefined, opts: { denyWarnings?: boolean } = {}): number {
        let failing = 0;
        for (const d of diagnostics ?? []) {
            this.diagnostic(d);
            if (d.severity === 'error') failing += 1;
            else if (opts.denyWarnings && d.severity === 'warning') failing += 1;
        }
        return failing;
    },
};

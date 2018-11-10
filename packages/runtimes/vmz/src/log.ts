// @ts-nocheck
/**
 * Unified CLI logging / diagnostics via `@vmz/diagnostic` + product catalog.
 */

import { formatDiagnostic } from '@vmz/diagnostic';
import { loadCliCatalog, resolveVmzLocale, vmzCliLocalize } from './cli-localize.js';

/** @param {string} level */
function stamp(level) {
    return `vmz ${level}`;
}

export const log = {
    /** @param {...unknown} args */
    info(...args) {
        console.error(stamp('info'), ...args);
    },
    /** @param {...unknown} args */
    warn(...args) {
        console.error(stamp('warn'), ...args);
    },
    /** @param {...unknown} args */
    error(...args) {
        console.error(stamp('error'), ...args);
    },
    /**
     * Localized framework error (`cli.err.*`).
     * @param {string} id
     * @param {Record<string, string>} [args]
     */
    errorId(id, args) {
        console.error(stamp('error'), vmzCliLocalize.t(id, args));
    },
    /** @param {{ severity?: string, path?: string, message?: string, code?: string, args?: Record<string, string>, span?: { start: number, end: number } }} d */
    diagnostic(d) {
        const severity =
            d.severity === 'warning' || d.severity === 'advice' || d.severity === 'error' ? d.severity : 'error';
        const code = d.code && String(d.code).length ? String(d.code) : 'diag.message';
        const locale = resolveVmzLocale();
        const catalog = loadCliCatalog(locale);
        const line = formatDiagnostic(
            {
                path: d.path || '',
                severity,
                code,
                args: d.args || (d.message ? { message: String(d.message) } : undefined),
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
    /**
     * @param {Array<{ severity?: string, path?: string, message?: string, code?: string, args?: Record<string, string> }>} diagnostics
     * @param {{ denyWarnings?: boolean }} [opts]
     * @returns {number} failing count (errors, and warnings if denyWarnings)
     */
    diagnostics(diagnostics, opts = {}) {
        let failing = 0;
        for (const d of diagnostics ?? []) {
            this.diagnostic(d);
            if (d.severity === 'error') failing += 1;
            else if (opts.denyWarnings && d.severity === 'warning') failing += 1;
        }
        return failing;
    },
};

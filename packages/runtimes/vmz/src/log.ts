// @ts-nocheck
/**
 * Unified CLI logging / diagnostics.
 * Framework lines use `errorId` + `@vmz/vmz` catalog; wire diagnostics prefer catalog[code] when present.
 */

import { renderDiagnosticMessage, vmzCliLocalize } from './cli-localize.js';

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
    /** @param {{ severity: string, path?: string, message?: string, code?: string, args?: Record<string, string> }} d */
    diagnostic(d) {
        const sev = d.severity || 'error';
        const code = d.code ? `${d.code}: ` : '';
        const message = renderDiagnosticMessage(d);
        const loc = d.path ? ` (${d.path})` : '';
        if (sev === 'warning') {
            console.error(`${stamp('warn')} ${code}${message}${loc}`);
            return;
        }
        console.error(
            `${stamp(sev === 'error' ? 'error' : sev)} ${code}${d.path ? `${d.path}: ` : ''}${message}`,
        );
    },
    /**
     * @param {Array<{ severity: string, path?: string, message?: string, code?: string, args?: Record<string, string> }>} diagnostics
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

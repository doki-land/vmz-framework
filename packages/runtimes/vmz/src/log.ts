// @ts-nocheck
/**
 * Unified CLI logging / diagnostics .
 */

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
    /** @param {{ severity: string, path?: string, message: string, code?: string }} d */
    diagnostic(d) {
        const sev = d.severity || 'error';
        const code = d.code ? `${d.code}: ` : '';
        const loc = d.path ? ` (${d.path})` : '';
        // Prefer `vmz warn|error CODE: message (path)` so locale warnings are visible, not silent.
        if (sev === 'warning') {
            console.error(`${stamp('warn')} ${code}${d.message}${loc}`);
            return;
        }
        console.error(`${stamp(sev === 'error' ? 'error' : sev)} ${code}${d.path ? `${d.path}: ` : ''}${d.message}`);
    },
    /**
     * @param {Array<{ severity: string, path?: string, message: string, code?: string }>} diagnostics
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

// @ts-nocheck
/**
 * Author declaration input via Rust N-API (no JS JSON5 package).
 *
 * Locale/document policy: loadLocalePlan / loadDocumentRoutePlan.
 * Catalogs / transitional tables: parseAuthorInput → Rust degrade → JSON.parse.
 */
import { requireNativeAddon } from './native-addon.js';

/**
 * Degrade author JSON5/JSON text to a plain object via Rust (not a semantic plan API).
 * @param {string} source
 * @returns {any}
 */
export function parseAuthorInput(source) {
    const native = requireNativeAddon();
    if (typeof native.authorJson5ToCanonicalJson !== 'function') {
        throw new Error('native missing authorJson5ToCanonicalJson — run `pnpm napi:build`');
    }
    return JSON.parse(native.authorJson5ToCanonicalJson(String(source)));
}

/**
 * @param {string} projectRoot
 */
export function loadLocalePlan(projectRoot) {
    const native = requireNativeAddon();
    if (typeof native.loadLocalePlan !== 'function') {
        throw new Error('native missing loadLocalePlan — run `pnpm napi:build`');
    }
    return JSON.parse(native.loadLocalePlan(String(projectRoot)));
}

/**
 * @param {string} projectRoot
 */
export function loadDocumentRoutePlan(projectRoot) {
    const native = requireNativeAddon();
    if (typeof native.loadDocumentRoutePlan !== 'function') {
        throw new Error('native missing loadDocumentRoutePlan — run `pnpm napi:build`');
    }
    return JSON.parse(native.loadDocumentRoutePlan(String(projectRoot)));
}

/**
 * Map Rust ReportedDiagnostic rows into host `{ code, severity, message, path }` rows.
 * @param {Array<{ code?: string, severity?: string, message?: string, path?: string }>} rows
 */
export function mapPlanDiagnostics(rows) {
    return (rows || []).map((d) => ({
        code: d.code || 'vmz::unknown',
        severity: d.severity === 'advice' ? 'warning' : d.severity || 'error',
        message: d.message || '',
        path: d.path || undefined,
    }));
}

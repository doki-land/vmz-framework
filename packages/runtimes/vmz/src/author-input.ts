/**
 * Author declaration input via Rust N-API (no JS JSON5 package).
 *
 * Locale/document policy: loadLocalePlan / loadDocumentRoutePlan.
 * Catalogs / transitional tables: parseAuthorInput → Rust degrade → JSON.parse.
 */
import { requireNativeAddon } from './native-addon.js';

export interface PlanDiagnostic {
    code?: string;
    severity?: string;
    message?: string;
    path?: string;
}

export interface MappedPlanDiagnostic {
    code: string;
    severity: string;
    message: string;
    path: string | undefined;
}

export interface LocalePlan {
    diagnostics?: PlanDiagnostic[];
    routing?: {
        strategy?: string;
        defaultPrefix?: string;
    };
    defaultLocale?: string;
}

export interface DocumentRouteCollection {
    id: string;
    sourceRoot?: string;
    routeBase?: string;
}

/** Normalized documents route plan from Rust (author JSON5/JSON/declaration). */
export interface DocumentRoutePlan {
    diagnostics?: PlanDiagnostic[];
    sourcePath?: string | null;
    defaultLocale?: string | null;
    localeLabels?: Record<string, string>;
    collections?: DocumentRouteCollection[];
    silentFallbackRequested?: boolean;
}

/** Degrade author JSON5/JSON text to a plain object via Rust (not a semantic plan API). */
export function parseAuthorInput(source: string): unknown {
    const native = requireNativeAddon();
    if (typeof native.authorJson5ToCanonicalJson !== 'function') {
        throw new Error('native missing authorJson5ToCanonicalJson — run `pnpm napi:build`');
    }
    return JSON.parse(native.authorJson5ToCanonicalJson(String(source)));
}

export function loadLocalePlan(projectRoot: string): LocalePlan {
    const native = requireNativeAddon();
    if (typeof native.loadLocalePlan !== 'function') {
        throw new Error('native missing loadLocalePlan — run `pnpm napi:build`');
    }
    return JSON.parse(native.loadLocalePlan(String(projectRoot))) as LocalePlan;
}

export function loadDocumentRoutePlan(projectRoot: string): DocumentRoutePlan {
    const native = requireNativeAddon();
    if (typeof native.loadDocumentRoutePlan !== 'function') {
        throw new Error('native missing loadDocumentRoutePlan — run `pnpm napi:build`');
    }
    return JSON.parse(native.loadDocumentRoutePlan(String(projectRoot))) as DocumentRoutePlan;
}

/** Map Rust ReportedDiagnostic rows into host `{ code, severity, message, path }` rows. */
export function mapPlanDiagnostics(rows: PlanDiagnostic[] | null | undefined): MappedPlanDiagnostic[] {
    return (rows || []).map((d) => ({
        code: d.code || 'vmz::unknown',
        severity: d.severity === 'advice' ? 'warning' : d.severity || 'error',
        message: d.message || '',
        path: d.path || undefined,
    }));
}

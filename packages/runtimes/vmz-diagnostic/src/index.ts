/**
 * `@vmz/diagnostic` — catalog render + pretty printer (skeleton).
 *
 * Product path: N-API diagnostic wire → `t(code, args)` → layout.
 */

/** Message id → template (`{name}` placeholders). */
export type LocaleCatalog = Record<string, string>;

/** Severity labels on the wire (kebab-case). */
export type Severity = 'error' | 'warning' | 'advice';

/** UTF-8 byte offset span (line/col only at render time). */
export type SourceSpan = {
    start: number;
    end: number;
};

/** Language-neutral diagnostic row (product wire shape). */
export type DiagnosticInput = {
    path: string;
    severity: Severity;
    code: string;
    args?: Record<string, string>;
    /**
     * Transitional wire prose when the product catalog has no entry for `code`.
     * Prefer catalog templates; do not treat this as a second i18n source of truth.
     */
    message?: string;
    span?: SourceSpan;
};

/** Optional offset → line/col context (aligned with compiler OffsetIndex later). */
export type PositionContext = {
    lineCol(offset: number): { line: number; column: number };
};

export type FormatOptions = {
    locale: string;
    catalog: LocaleCatalog | ((locale: string) => LocaleCatalog);
    sourceText?: string;
    position?: PositionContext;
};

/**
 * Resolve a catalog template with `{arg}` substitution.
 * Missing keys fall back to `{{code}}` so wire identity stays visible.
 */
export function t(code: string, args: Record<string, string> | undefined, catalog: LocaleCatalog): string {
    const template = catalog[code];
    if (template == null) {
        return `{{${code}}}`;
    }
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name: string) => {
        if (args && Object.prototype.hasOwnProperty.call(args, name)) {
            return args[name] ?? '';
        }
        return `{${name}}`;
    });
}

function resolveCatalog(locale: string, catalog: LocaleCatalog | ((locale: string) => LocaleCatalog)): LocaleCatalog {
    return typeof catalog === 'function' ? catalog(locale) : catalog;
}

/**
 * Format one diagnostic for terminal / logs.
 * Skeleton: single-line `path: severity[code]: message` — no snippet yet.
 */
export function formatDiagnostic(d: DiagnosticInput, opts: FormatOptions): string {
    if (!d.code || typeof d.code !== 'string') {
        throw new Error('@vmz/diagnostic: DiagnosticInput.code is required');
    }
    const catalog = resolveCatalog(opts.locale, opts.catalog);
    const message = Object.prototype.hasOwnProperty.call(catalog, d.code)
        ? t(d.code, d.args, catalog)
        : d.message != null && String(d.message).length
          ? String(d.message)
          : t(d.code, d.args, catalog);
    const where = formatWhere(d, opts);
    const head = where ? `${where}: ` : '';
    return `${head}${d.severity}[${d.code}]: ${message}`;
}

/**
 * Format many diagnostics, one per line.
 */
export function formatDiagnostics(list: DiagnosticInput[], opts: FormatOptions): string {
    return list.map((d) => formatDiagnostic(d, opts)).join('\n');
}

function formatWhere(d: DiagnosticInput, opts: FormatOptions): string {
    const path = d.path || '';
    if (!d.span || !opts.position) {
        return path;
    }
    const { line, column } = opts.position.lineCol(d.span.start);
    return path ? `${path}:${line}:${column}` : `${line}:${column}`;
}

/**
 * Shared class/style normalization for Direct SSR + client (0.1.33).
 * Vue-compatible: string | string[] | object map | falsy parts.
 *
 * Style keys are normalized to CSS property spelling so SSR text and client
 * patches agree: camelCase becomes kebab-case, custom properties (`--x`) pass
 * through untouched, and names that cannot be CSS properties (whitespace, `;`,
 * `:`, leading digit) are dropped — the same fate invalid declarations have in
 * the browser. Numeric values gain `px` except for unitless properties, `0`,
 * and custom properties. Array values emit repeated declarations (vendor
 * fallback chains) and nested arrays flatten.
 */

function pushClassTokens(out: string[], value: unknown): void {
    if (value == null || value === false) return;
    if (typeof value === 'string') {
        for (const token of value.split(/\s+/)) {
            if (token) out.push(token);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) pushClassTokens(out, item);
        return;
    }
    if (typeof value === 'object') {
        for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
            if (enabled) out.push(key);
        }
        return;
    }
    const s = String(value).trim();
    if (s) out.push(s);
}

/** Normalize one or more class fragments into a deduped class string. */
export function mergeClassParts(...parts: unknown[]): string {
    const tokens: string[] = [];
    for (const part of parts) pushClassTokens(tokens, part);
    return [...new Set(tokens)].join(' ');
}

/** CSS properties whose numeric values stay unitless (kebab-case names). */
const UNITLESS_STYLE_PROPS = new Set([
    'animation-iteration-count',
    'aspect-ratio',
    'border-image-outset',
    'border-image-slice',
    'border-image-width',
    'box-flex',
    'box-flex-group',
    'box-ordinal-group',
    'column-count',
    'columns',
    'flex',
    'flex-grow',
    'flex-positive',
    'flex-shrink',
    'flex-negative',
    'flex-order',
    'grid-row',
    'grid-row-end',
    'grid-row-span',
    'grid-row-start',
    'grid-column',
    'grid-column-end',
    'grid-column-span',
    'grid-column-start',
    'font-weight',
    'line-clamp',
    'line-height',
    'opacity',
    'order',
    'orphans',
    'scale',
    'tab-size',
    'widows',
    'z-index',
    'zoom',
    'fill-opacity',
    'flood-opacity',
    'stop-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
]);

/** camelCase → kebab-case, `--custom` preserved; `null` when not a CSS property name. */
function normalizeStyleKey(raw: string): string | null {
    const key = raw.trim();
    if (!key) return null;
    if (key.startsWith('--')) {
        return /^--[\w-]+$/.test(key) ? key : null;
    }
    const kebab = key.replace(/\B([A-Z])/g, '-$1').toLowerCase();
    return /^[a-z][a-z0-9-]*$/.test(kebab) ? kebab : null;
}

/** One style value as declaration text; `null` drops the declaration. */
function normalizeStyleValue(key: string, value: unknown): string | null {
    if (value == null || value === false) return null;
    if (typeof value === 'number' && value !== 0 && !key.startsWith('--') && !isUnitlessStyleProp(key)) {
        return `${value}px`;
    }
    return String(value);
}

/** Unitless lookup ignores vendor prefixes (`webkit-line-clamp` ≙ `line-clamp`). */
function isUnitlessStyleProp(key: string): boolean {
    const unprefixed = key.replace(/^(?:-?(?:webkit|moz|ms|o))-/, '');
    return UNITLESS_STYLE_PROPS.has(unprefixed);
}

function pushStyleValues(out: string[], key: string, value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) pushStyleValues(out, key, item);
        return;
    }
    const text = normalizeStyleValue(key, value);
    if (text != null) out.push(text);
}

/**
 * Split a style fragment on top-level `;`. Semicolons inside `url(...)` /
 * nested parens and inside quotes (e.g. `content: 'a;b'`, data URIs with
 * `;base64,`) do not split — a naive split would truncate those values.
 */
export function splitStyleDeclarations(text: string): string[] {
    const chunks: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (quote != null) {
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '(') {
            depth += 1;
        } else if (ch === ')') {
            if (depth > 0) depth -= 1;
        } else if (ch === ';' && depth === 0) {
            chunks.push(text.slice(start, i));
            start = i + 1;
        }
        i += 1;
    }
    chunks.push(text.slice(start));
    return chunks;
}

function collectStyleDeclarations(merged: Map<string, string[]>, value: unknown): void {
    if (value == null || value === false) return;
    if (typeof value === 'string') {
        for (const chunk of splitStyleDeclarations(value)) {
            const idx = chunk.indexOf(':');
            if (idx < 0) continue;
            const key = normalizeStyleKey(chunk.slice(0, idx));
            if (!key) continue;
            merged.set(key, [chunk.slice(idx + 1).trim()]);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStyleDeclarations(merged, item);
        return;
    }
    if (typeof value === 'object') {
        for (const [rawKey, raw] of Object.entries(value as Record<string, unknown>)) {
            const key = normalizeStyleKey(rawKey);
            if (!key) continue;
            const values: string[] = [];
            pushStyleValues(values, key, raw);
            if (values.length) merged.set(key, values);
        }
    }
}

/** Merge static + dynamic style fragments; later parts override same keys. */
export function mergeStyleParts(...parts: unknown[]): string {
    const merged = new Map<string, string[]>();
    for (const part of parts) collectStyleDeclarations(merged, part);
    const out: string[] = [];
    for (const [key, values] of merged) {
        for (const value of values) out.push(`${key}: ${value}`);
    }
    return out.join('; ');
}

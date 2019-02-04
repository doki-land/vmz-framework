/**
 * Shared class/style normalization for Direct SSR + client (0.1.33).
 * Vue-compatible: string | string[] | object map | falsy parts.
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

function parseStyleObject(value: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (value == null || value === false) return out;
    if (typeof value === 'string') {
        for (const chunk of value.split(';')) {
            const idx = chunk.indexOf(':');
            if (idx < 0) continue;
            const key = chunk.slice(0, idx).trim();
            const val = chunk.slice(idx + 1).trim();
            if (key) out[key] = val;
        }
        return out;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
            if (raw == null || raw === false) continue;
            out[key] = String(raw);
        }
    }
    return out;
}

/** Merge static + dynamic style fragments; later parts override same keys. */
export function mergeStyleParts(...parts: unknown[]): string {
    const merged: Record<string, string> = {};
    for (const part of parts) Object.assign(merged, parseStyleObject(part));
    return Object.entries(merged)
        .map(([key, val]) => `${key}: ${val}`)
        .join('; ');
}

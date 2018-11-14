/**
 * Locale key validation & canonicalization .
 */

import { LOCALE_ALIASES } from './document-schema.js';

/** Literal must be lowercase ASCII BCP 47-ish with `-` separators only. */
const LOCALE_LITERAL_RE = /^[a-z]{2,3}(-[a-z0-9]+)*$/;

export type ValidateLocaleResult = { ok: true; soft: string; canonical: string } | { ok: false; code: string; message: string };

/** Soft-normalize for alias / conflict detection (does not validate). */
export function softNormalizeLocale(raw: string): string {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-');
}

/** Map soft-normalized key through alias table. */
export function canonicalLocale(soft: string): string {
    const s = softNormalizeLocale(soft);
    return LOCALE_ALIASES[s] || s;
}

/** Validate a top-level locale directory name. */
export function validateLocaleLiteral(literal: string): ValidateLocaleResult {
    const name = String(literal || '');
    if (!name) {
        return { ok: false, code: 'document::locale::invalid', message: 'empty locale key' };
    }
    if (name.includes('_')) {
        return {
            ok: false,
            code: 'document::locale::separator',
            message: `locale key must use '-' not '_': ${JSON.stringify(name)}`,
        };
    }
    if (name !== name.toLowerCase()) {
        return {
            ok: false,
            code: 'document::locale::case',
            message: `locale key must be lowercase ASCII (got ${JSON.stringify(name)}; use ${JSON.stringify(name.toLowerCase())})`,
        };
    }
    if (!LOCALE_LITERAL_RE.test(name)) {
        return {
            ok: false,
            code: 'document::locale::invalid',
            message: `locale key is not a valid lowercase BCP 47 form: ${JSON.stringify(name)}`,
        };
    }
    const soft = softNormalizeLocale(name);
    return { ok: true, soft, canonical: canonicalLocale(soft) };
}

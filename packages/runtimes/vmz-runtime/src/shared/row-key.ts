/** SSR row identity for multi-root `<template v-for>` rows. */
export const ROW_MARKER_PREFIX = 'vmz-row:';
export const ROW_END_MARKER_PREFIX = 'vmz-row-end:';

/**
 * Comment-safe row key token.
 *
 * Row identity travels inside HTML comments, where `--` is illegal. Encode the
 * key once (both SSR writer and resume reader use this same function) and strip
 * the remaining hyphens so no key can ever close the comment early.
 */
export function rowKeyToken(key: unknown): string {
    return encodeURIComponent(String(key)).replace(/-/g, '%2D');
}

export function rowMarker(key: unknown): string {
    return `${ROW_MARKER_PREFIX}${rowKeyToken(key)}`;
}

export function rowEndMarker(key: unknown): string {
    return `${ROW_END_MARKER_PREFIX}${rowKeyToken(key)}`;
}

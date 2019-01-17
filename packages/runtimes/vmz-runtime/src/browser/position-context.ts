/**
 * PositionContext backed by compiler OffsetIndex via N-API (`offsetIndexLineCol`).
 * `@vmz/diagnostic` stays free of a native dependency — hosts wire this helper.
 */

import { requireNativeFn } from '../host/native-addon.js';

export type LineCol = { line: number; column: number };

export type PositionContext = {
    lineCol(offset: number): LineCol;
};

/**
 * Build a diagnostic PositionContext for `sourceText` using the native OffsetIndex.
 */
export function createPositionContext(sourceText: string): PositionContext {
    const source = String(sourceText ?? '');
    const lineColFn = requireNativeFn('offsetIndexLineCol') as (src: string, offset: number) => { line: number; column: number };
    return {
        lineCol(offset: number): LineCol {
            const off = Math.max(0, Number(offset) || 0);
            const row = lineColFn(source, off >>> 0);
            return { line: row.line, column: row.column };
        },
    };
}

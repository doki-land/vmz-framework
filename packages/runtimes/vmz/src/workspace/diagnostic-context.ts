/**
 * Source cache + OffsetIndex-backed PositionContext for CLI pretty diagnostics.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { PositionContext } from '@vmz/diagnostic';
import { loadNative } from './public-api.js';

const sourceCache = new Map<string, string>();
const positionCache = new Map<string, PositionContext>();

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

/** Read and memoize a source file for snippet rendering. */
export function readDiagnosticSource(path: string): string | undefined {
    const key = normalizePath(path);
    if (sourceCache.has(key)) return sourceCache.get(key);
    if (!path || !existsSync(path)) return undefined;
    try {
        const text = readFileSync(path, 'utf8');
        sourceCache.set(key, text);
        return text;
    } catch {
        return undefined;
    }
}

/** OffsetIndex PositionContext for one source buffer (memoized per path). */
export function positionContextForSource(path: string, sourceText: string): PositionContext {
    const key = normalizePath(path);
    const cached = positionCache.get(key);
    if (cached) return cached;
    const native = loadNative() as {
        offsetIndexLineCol?: (source: string, offset: number) => { line: number; column: number };
    };
    if (typeof native.offsetIndexLineCol !== 'function') {
        const fallback: PositionContext = { lineCol: () => ({ line: 1, column: 1 }) };
        positionCache.set(key, fallback);
        return fallback;
    }
    const source = String(sourceText ?? '');
    const ctx: PositionContext = {
        lineCol(offset: number): { line: number; column: number } {
            const row = native.offsetIndexLineCol!(source, Math.max(0, Number(offset) || 0) >>> 0);
            return { line: row.line, column: row.column };
        },
    };
    positionCache.set(key, ctx);
    return ctx;
}

/** Clear caches between CLI invocations in long-lived hosts. */
export function resetDiagnosticContext(): void {
    sourceCache.clear();
    positionCache.clear();
}

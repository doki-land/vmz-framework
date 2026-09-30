/** UTF-8 byte helpers for Rust wire spans in a JS string buffer. */

export function utf8ByteLength(source: string): number {
    return Buffer.byteLength(source, 'utf8');
}

export function utf8ByteSlice(source: string, start: number, end: number): string {
    const buf = Buffer.from(source, 'utf8');
    const s = Math.max(0, Math.min(start, buf.length));
    const e = Math.max(s, Math.min(end, buf.length));
    return buf.subarray(s, e).toString('utf8');
}

export type Utf8LineSlice = {
    line: number;
    lineStart: number;
    lineEnd: number;
    text: string;
};

/** Line containing `offset` (UTF-8 bytes, 1-based line number). */
export function utf8LineAt(source: string, offset: number): Utf8LineSlice {
    const buf = Buffer.from(source, 'utf8');
    const clamped = Math.max(0, Math.min(offset, buf.length));
    let lineStart = clamped;
    while (lineStart > 0 && buf[lineStart - 1] !== 0x0a) {
        lineStart -= 1;
    }
    let lineEnd = clamped;
    while (lineEnd < buf.length && buf[lineEnd] !== 0x0a) {
        lineEnd += 1;
    }
    let line = 1;
    for (let i = 0; i < lineStart; i += 1) {
        if (buf[i] === 0x0a) line += 1;
    }
    return {
        line,
        lineStart,
        lineEnd,
        text: buf.subarray(lineStart, lineEnd).toString('utf8'),
    };
}

/** 1-based Unicode scalar column within a line slice (matches compiler OffsetIndex). */
export function unicodeScalarColumn(lineText: string, byteOffsetInLine: number): number {
    const buf = Buffer.from(lineText, 'utf8');
    const end = Math.max(0, Math.min(byteOffsetInLine, buf.length));
    if (end === 0) return 1;
    return buf.subarray(0, end).toString('utf8').length > 0
        ? [...buf.subarray(0, end).toString('utf8')].length
        : 1;
}

/** Map 1-based scalar column to JS string index for underline rendering. */
export function scalarColumnToIndex(lineText: string, column: number): number {
    if (column <= 1) return 0;
    let pos = 1;
    let index = 0;
    for (const ch of lineText) {
        if (pos >= column) break;
        index += ch.length;
        pos += 1;
    }
    return index;
}

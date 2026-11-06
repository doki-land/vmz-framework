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
    return buf.subarray(0, end).toString('utf8').length > 0 ? [...buf.subarray(0, end).toString('utf8')].length : 1;
}

const ZERO_WIDTH_PATTERN = /\p{Mn}|\p{Me}|\p{Cf}/u;

function isWideCodePoint(cp: number): boolean {
    return (
        (cp >= 0x1100 && cp <= 0x115f) ||
        cp === 0x2329 ||
        cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0x303e) ||
        (cp >= 0x3041 && cp <= 0x33ff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0xa000 && cp <= 0xa4cf) ||
        (cp >= 0xa960 && cp <= 0xa97f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1b000 && cp <= 0x1b2ff) ||
        (cp >= 0x1f000 && cp <= 0x1f02f) ||
        (cp >= 0x1f0a0 && cp <= 0x1f0ff) ||
        (cp >= 0x1f100 && cp <= 0x1f1ad) ||
        (cp >= 0x1f300 && cp <= 0x1f64f) ||
        (cp >= 0x1f680 && cp <= 0x1f6ff) ||
        (cp >= 0x1f900 && cp <= 0x1f9ff) ||
        (cp >= 0x1fa70 && cp <= 0x1faff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
    );
}

/** Terminal cells occupied by one Unicode scalar (wide CJK/emoji render as two, CR as zero). */
export function scalarDisplayWidth(ch: string): number {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0 || cp === 0x0d || ZERO_WIDTH_PATTERN.test(ch)) return 0;
    return isWideCodePoint(cp) ? 2 : 1;
}

/** Tab stops used when rendering source snippets, matching rustc and miette defaults. */
export const SNIPPET_TAB_WIDTH = 4;

/** Display width of a line fragment in terminal cells (tabs advance to the next stop). */
export function displayWidth(text: string): number {
    let cells = 0;
    for (const ch of text) {
        if (ch === '\t') {
            cells += SNIPPET_TAB_WIDTH - (cells % SNIPPET_TAB_WIDTH);
        } else {
            cells += scalarDisplayWidth(ch);
        }
    }
    return cells;
}

/**
 * Expand tabs to spaces so the printed source line and the caret row agree in
 * any terminal, regardless of that terminal's own tab-stop configuration.
 * Carriage returns from CRLF sources are dropped because they terminate the
 * line rather than occupy a cell.
 */
export function expandTabs(text: string): string {
    let cells = 0;
    let out = '';
    for (const ch of text) {
        if (ch === '\r') continue;
        if (ch === '\t') {
            const pad = SNIPPET_TAB_WIDTH - (cells % SNIPPET_TAB_WIDTH);
            out += ' '.repeat(pad);
            cells += pad;
            continue;
        }
        out += ch;
        cells += scalarDisplayWidth(ch);
    }
    return out;
}

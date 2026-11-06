import type { DiagnosticInput, FormatOptions, PositionContext, Severity } from './index.js';
import { displayWidth, expandTabs, utf8ByteSlice, utf8LineAt } from './utf8.js';

export type PrettyStyle = 'compact' | 'pretty';

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
};

function useColor(): boolean {
    return !process.env.NO_COLOR && Boolean(process.stderr?.isTTY);
}

function paint(text: string, ...styles: string[]): string {
    if (!useColor() || styles.length === 0) return text;
    return `${styles.join('')}${text}${ANSI.reset}`;
}

function severityStyle(severity: Severity): string[] {
    if (severity === 'error') return [ANSI.bold, ANSI.red];
    if (severity === 'warning') return [ANSI.bold, ANSI.yellow];
    return [ANSI.cyan];
}

function severityLabel(severity: Severity): string {
    return severity === 'warning' ? 'warning' : severity;
}

function formatLocation(path: string, line: number, column: number): string {
    const where = path ? `${path}:${line}:${column}` : `${line}:${column}`;
    return paint(`  --> ${where}`, ANSI.bold, ANSI.blue);
}

function canRenderSnippet(d: DiagnosticInput, opts: FormatOptions & { style?: PrettyStyle }): boolean {
    return (
        (opts.style ?? 'pretty') === 'pretty' &&
        Boolean(opts.sourceText && opts.position && d.span && d.span.end >= d.span.start)
    );
}

function renderSnippetLine(
    out: string[],
    gutterWidth: number,
    lineNum: number,
    lineText: string,
    startCell: number,
    endCell: number,
    severity: Severity,
): void {
    const gutter = paint(`${String(lineNum).padStart(gutterWidth)} | `, ANSI.dim);
    out.push(`${gutter}${expandTabs(lineText)}`);
    const marker =
        paint(`${' '.repeat(gutterWidth)} | `, ANSI.dim) +
        ' '.repeat(startCell) +
        paint('^'.repeat(Math.max(1, endCell - startCell)), ...severityStyle(severity));
    out.push(marker);
}

export function formatDiagnosticPretty(d: DiagnosticInput, message: string, opts: FormatOptions & { style?: PrettyStyle }): string {
    const head = paint(`${severityLabel(d.severity)}[${d.code}]`, ...severityStyle(d.severity));
    const lines: string[] = [`${head}: ${message}`];

    if (!canRenderSnippet(d, opts)) {
        const path = d.path || '';
        if (d.span && opts.position) {
            const { line, column } = opts.position.lineCol(d.span.start);
            lines.push(formatLocation(path, line, column));
        } else if (path) {
            lines.push(paint(`  at ${path}`, ANSI.dim));
        }
        return lines.join('\n');
    }

    const source = String(opts.sourceText);
    const position = opts.position as PositionContext;
    const span = d.span!;
    const path = d.path || '';
    const startPos = position.lineCol(span.start);
    lines.push(formatLocation(path, startPos.line, startPos.column));

    const startLine = utf8LineAt(source, span.start);
    const endLine = utf8LineAt(source, Math.max(span.start, span.end - 1));
    const gutterWidth = String(endLine.line).length;

    if (startLine.line === endLine.line) {
        renderSnippetLine(
            lines,
            gutterWidth,
            startLine.line,
            startLine.text,
            displayWidth(utf8ByteSlice(source, startLine.lineStart, span.start)),
            displayWidth(utf8ByteSlice(source, startLine.lineStart, Math.min(span.end, startLine.lineEnd))),
            d.severity,
        );
    } else {
        renderSnippetLine(
            lines,
            gutterWidth,
            startLine.line,
            startLine.text,
            displayWidth(utf8ByteSlice(source, startLine.lineStart, span.start)),
            displayWidth(startLine.text),
            d.severity,
        );
        if (endLine.line > startLine.line + 1) {
            lines.push(paint(`${' '.repeat(gutterWidth + 3)}...`, ANSI.dim));
        }
        renderSnippetLine(
            lines,
            gutterWidth,
            endLine.line,
            endLine.text,
            0,
            displayWidth(utf8ByteSlice(source, endLine.lineStart, Math.min(span.end, endLine.lineEnd))),
            d.severity,
        );
    }

    return lines.join('\n');
}

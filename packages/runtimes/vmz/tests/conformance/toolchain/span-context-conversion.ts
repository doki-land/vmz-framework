/**
 * span-context-conversion — OffsetIndex N-API ↔ PositionContext / formatDiagnostic.
 */
import assert from 'node:assert/strict';
import { formatDiagnostic } from '@vmz/diagnostic';
import { createPositionContext } from '../../../../vmz-runtime/src/browser/position-context.ts';
import { loadNative } from 'vmz';

function fail(msg: string): never {
    console.error(`SPAN-CONTEXT-CONVERSION GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('span-context-conversion: native OffsetIndex…');
const native = loadNative() as {
    offsetIndexLineCol?: (
        source: string,
        offset: number,
    ) => {
        line: number;
        column: number;
        lspPosition: { line: number; character: number };
    };
};
if (typeof native.offsetIndexLineCol !== 'function') {
    fail('native missing offsetIndexLineCol — run pnpm napi:build');
}

const ascii = 'a\nbc';
const asciiAt = native.offsetIndexLineCol(ascii, 2); // 'b'
assert.equal(asciiAt.line, 2);
assert.equal(asciiAt.column, 1);

const cjk = '你\n好';
const cjkBytes = Buffer.from(cjk, 'utf8');
const offsetHao = cjkBytes.indexOf(Buffer.from('好', 'utf8'));
const cjkAt = native.offsetIndexLineCol(cjk, offsetHao);
assert.equal(cjkAt.line, 2);
assert.equal(cjkAt.column, 1);

const emoji = 'hi\n😀x';
const emojiOff = Buffer.from(emoji, 'utf8').indexOf(Buffer.from('😀', 'utf8'));
const emojiAt = native.offsetIndexLineCol(emoji, emojiOff);
assert.equal(emojiAt.line, 2);
assert.equal(emojiAt.column, 1);
assert.equal(emojiAt.lspPosition.line, 1);
assert.equal(emojiAt.lspPosition.character, 0);

console.log('span-context-conversion: PositionContext + formatDiagnostic…');
const source = 'line1\n中文';
const pos = createPositionContext(source);
const mid = Buffer.from(source, 'utf8').indexOf(Buffer.from('中', 'utf8'));
const where = formatDiagnostic(
    {
        path: 'demo.vmz',
        severity: 'error',
        code: 'test.code',
        span: { start: mid, end: mid + 3 },
    },
    {
        locale: 'en-US',
        catalog: { 'test.code': 'boom' },
        position: pos,
        sourceText: source,
        style: 'pretty',
    },
);
assert.match(where, /^error\[test\.code\]: boom\n  --> demo\.vmz:2:1\n/);
// rustc style: the caret row repeats only the gutter (`  | `), never the line number.
// A wide CJK scalar occupies two terminal cells, so the underline covers both.
assert.equal(where, 'error[test.code]: boom\n  --> demo.vmz:2:1\n2 | 中文\n  | ^^');

// Caret row is padded by rendered cells, not by Unicode scalar columns.
const wideSource = 'line1\n中文x';
const widePos = createPositionContext(wideSource);
const wen = Buffer.from(wideSource, 'utf8').indexOf(Buffer.from('文', 'utf8'));
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: wen, end: wen + 3 },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: widePos,
            sourceText: wideSource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:2:2\n2 | 中文x\n  |   ^^',
);

// A combining mark adds zero cells, an emoji presentation scalar adds two.
const combiningSource = 'line1\ne\u0301x';
const combining = Buffer.from(combiningSource, 'utf8').indexOf(Buffer.from('e\u0301', 'utf8'));
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: combining, end: combining + Buffer.byteLength('e\u0301', 'utf8') },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: createPositionContext(combiningSource),
            sourceText: combiningSource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:2:1\n2 | e\u0301x\n  | ^',
);
const emojiSource = 'line1\n😀x';
const emojiWidth = Buffer.from(emojiSource, 'utf8').indexOf(Buffer.from('😀', 'utf8'));
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: emojiWidth, end: emojiWidth + 4 },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: createPositionContext(emojiSource),
            sourceText: emojiSource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:2:1\n2 | 😀x\n  | ^^',
);

// A zero-width span points at an insertion site and still gets one caret.
const emptySource = 'ab\ncd';
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: Buffer.byteLength(emptySource, 'utf8'), end: Buffer.byteLength(emptySource, 'utf8') },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: createPositionContext(emptySource),
            sourceText: emptySource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:2:3\n2 | cd\n  |   ^',
);
const wideEmptySource = '中\n文x';
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: 7, end: 7 },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: createPositionContext(wideEmptySource),
            sourceText: wideEmptySource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:2:2\n2 | 文x\n  |   ^',
);

// A span across lines renders both endpoint lines, with `...` skipping the middle.
const multiSource = 'aaa\nbbb\nccc\nddd';
const multiStart = Buffer.from(multiSource, 'utf8').indexOf(Buffer.from('aaa', 'utf8'));
assert.equal(
    formatDiagnostic(
        {
            path: 'demo.vmz',
            severity: 'error',
            code: 'test.code',
            span: { start: multiStart, end: Buffer.byteLength('aaa\nbbb\nccc', 'utf8') },
        },
        {
            locale: 'en-US',
            catalog: { 'test.code': 'boom' },
            position: createPositionContext(multiSource),
            sourceText: multiSource,
            style: 'pretty',
        },
    ),
    'error[test.code]: boom\n  --> demo.vmz:1:1\n1 | aaa\n  | ^^^\n    ...\n3 | ccc\n  | ^^^',
);

console.log('SPAN-CONTEXT-CONVERSION GATE OK');

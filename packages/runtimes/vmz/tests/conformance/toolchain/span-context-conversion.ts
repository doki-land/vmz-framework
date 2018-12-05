/**
 * span-context-conversion — OffsetIndex N-API ↔ PositionContext / formatDiagnostic.
 */
import assert from 'node:assert/strict';
import { formatDiagnostic } from '@vmz/diagnostic';
import { createPositionContext } from '../../../../vmz-runtime/src/position-context.ts';
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
    },
);
assert.match(where, /^demo\.vmz:2:1: error\[test\.code\]: boom$/);

console.log('SPAN-CONTEXT-CONVERSION GATE OK');

import { describe, expect, it } from 'vitest';
import { formatDiagnostic } from '@vmz/diagnostic';

describe('diagnostic pretty printer', () => {
    it('renders rustc-style snippet when span + source are available', () => {
        const source = '<template>\n<li v-for="x in xs"></li>\n</template>\n';
        const lineStart = source.indexOf('<li');
        const out = formatDiagnostic(
            {
                path: 'App.vmz',
                severity: 'warning',
                code: 'vmz::template::each_missing_key',
                args: { tag: 'li' },
                span: { start: lineStart, end: lineStart + 3 },
            },
            {
                locale: 'en-US',
                catalog: {
                    'vmz::template::each_missing_key': '`v-for` on `<{tag}>` should declare a `:key`',
                },
                sourceText: source,
                position: {
                    lineCol(offset: number) {
                        const before = source.slice(0, Math.max(0, offset));
                        const line = before.split('\n').length;
                        const column = (before.split('\n').pop() ?? '').length + 1;
                        return { line, column };
                    },
                },
                style: 'pretty',
            },
        );
        expect(out.startsWith('warning[vmz::template::each_missing_key]:')).toBe(true);
        expect(out).toContain('  --> App.vmz:2:1');
        expect(out).toContain('| <li');
        expect(out).toContain('^');
    });

    it('falls back to path footer without span', () => {
        const out = formatDiagnostic(
            {
                path: 'src/App.vmz',
                severity: 'error',
                code: 'vmz::router::route_table_invalid',
                args: { detail: 'duplicate' },
            },
            {
                locale: 'en-US',
                catalog: { 'vmz::router::route_table_invalid': 'Invalid route table: {detail}' },
                style: 'pretty',
            },
        );
        expect(out).toBe('error[vmz::router::route_table_invalid]: Invalid route table: duplicate\n  at src/App.vmz');
    });
});

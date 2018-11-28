/**
 * Product diagnostic catalogs (en-US / zh-CN) — code+args identity across locales.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { clearLocalesCache, loadCatalog, loadLocalesManifest } from '@vmz/commander';
import { formatDiagnostic, type DiagnosticInput } from '@vmz/diagnostic';

const localesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

const JSX_INPUT: DiagnosticInput = {
    path: 'src/App.vmz',
    severity: 'error',
    code: 'vmz::template::jsx_rejected',
    args: { detail: 'JSX is not allowed' },
    span: { start: 12, end: 18 },
};

describe('vmz diagnostic locale catalogs', () => {
    before(() => clearLocalesCache());
    after(() => clearLocalesCache());

    it('manifest lists zh-CN with fallback to en-US', () => {
        const manifest = loadLocalesManifest(localesRoot);
        expect(manifest.defaultLocale).toBe('en-US');
        expect(manifest.locales.some((l) => l.id === 'zh-CN')).toBe(true);
        expect(manifest.fallback?.['zh-CN']).toEqual(['en-US']);
    });

    it('formats the same DiagnosticInput in en-US and zh-CN with identical wire fields', () => {
        const en = loadCatalog('en-US', localesRoot);
        const zh = loadCatalog('zh-CN', localesRoot);

        expect(en['vmz::template::jsx_rejected']).toBeTruthy();
        expect(zh['vmz::template::jsx_rejected']).toBeTruthy();

        const enLine = formatDiagnostic(JSX_INPUT, { locale: 'en-US', catalog: en });
        const zhLine = formatDiagnostic(JSX_INPUT, { locale: 'zh-CN', catalog: zh });

        expect(enLine).toContain('error[vmz::template::jsx_rejected]');
        expect(zhLine).toContain('error[vmz::template::jsx_rejected]');
        expect(enLine).toContain('src/App.vmz');
        expect(zhLine).toContain('src/App.vmz');
        expect(enLine).toContain('JSX is not allowed');
        expect(zhLine).toContain('JSX is not allowed');
        expect(enLine).not.toBe(zhLine);

        // Structured identity: same code / args / span regardless of locale render.
        expect(JSX_INPUT.code).toBe('vmz::template::jsx_rejected');
        expect(JSX_INPUT.args).toEqual({ detail: 'JSX is not allowed' });
        expect(JSX_INPUT.span).toEqual({ start: 12, end: 18 });
    });

    it('missing translation falls back without changing structured fields', () => {
        const zh = loadCatalog('zh-CN', localesRoot);
        const input: DiagnosticInput = {
            path: 'x.vmz',
            severity: 'warning',
            code: 'vmz::test::missing_catalog_key_for_fallback',
            args: { detail: 'wire-detail' },
            message: 'transitional prose',
            span: { start: 1, end: 2 },
        };

        const line = formatDiagnostic(input, { locale: 'zh-CN', catalog: zh });
        // Catalog miss → transitional message; wire fields stay on the input object.
        expect(line).toContain('warning[vmz::test::missing_catalog_key_for_fallback]');
        expect(line).toContain('transitional prose');
        expect(input.code).toBe('vmz::test::missing_catalog_key_for_fallback');
        expect(input.args).toEqual({ detail: 'wire-detail' });
        expect(input.span).toEqual({ start: 1, end: 2 });
        expect(zh['vmz::test::missing_catalog_key_for_fallback'] == null).toBe(true);
        // cli keys still available via en-US fallback merge
        expect(zh['cli.cmd.build']).toBeTruthy();
    });
});

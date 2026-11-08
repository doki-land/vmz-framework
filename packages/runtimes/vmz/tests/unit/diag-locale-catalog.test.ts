/**
 * Product diagnostic catalogs (en-US / zh-CN) — code+args identity across locales.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { clearLocalesCache, loadCatalog, loadLocalesManifest } from '@vmz/commander';
import { formatDiagnostic, type DiagnosticInput } from '@vmz/diagnostic';
import { mapPlanDiagnostics } from '../../src/workspace/author-input.js';

const localesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

const PARSE_INPUT: DiagnosticInput = {
    path: 'src/App.vmz',
    severity: 'error',
    code: 'vmz::template::parse_failed',
    args: { detail: 'single-brace is not allowed' },
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

        expect(en['vmz::template::parse_failed']).toBeTruthy();
        expect(zh['vmz::template::parse_failed']).toBeTruthy();

        const enLine = formatDiagnostic(PARSE_INPUT, { locale: 'en-US', catalog: en });
        const zhLine = formatDiagnostic(PARSE_INPUT, { locale: 'zh-CN', catalog: zh });

        expect(enLine).toContain('error[vmz::template::parse_failed]');
        expect(zhLine).toContain('error[vmz::template::parse_failed]');
        expect(enLine).toContain('src/App.vmz');
        expect(zhLine).toContain('src/App.vmz');
        expect(enLine).toContain('single-brace is not allowed');
        expect(zhLine).toContain('single-brace is not allowed');
        expect(enLine).not.toBe(zhLine);

        // Structured identity: same code / args / span regardless of locale render.
        expect(PARSE_INPUT.code).toBe('vmz::template::parse_failed');
        expect(PARSE_INPUT.args).toEqual({ detail: 'single-brace is not allowed' });
        expect(PARSE_INPUT.span).toEqual({ start: 12, end: 18 });
    });

    it('plan diagnostic args survive the host projection and interpolate', () => {
        // Rust 侧 `load_locale_plan` 只给 code + args，文案在 catalog 里：宿主投影
        // 丢掉 args 就会把 `{detail}` 原样打进产物告警。
        const [row] = mapPlanDiagnostics([
            {
                code: 'vmz::locale::manifest_missing',
                severity: 'warning',
                path: 'locales/locales.json5',
                args: { detail: 'locales/locales.json5 missing' },
            },
        ]);
        expect(row.args).toEqual({ detail: 'locales/locales.json5 missing' });

        const zh = loadCatalog('zh-CN', localesRoot);
        const line = formatDiagnostic({ ...row, severity: 'warning' }, { locale: 'zh-CN', catalog: zh });
        expect(zh['vmz::locale::manifest_missing']).toBeTruthy();
        expect(line).not.toContain('{detail}');
        expect(line).toContain('locales/locales.json5 missing');
        // 丢 args 的旧投影正是本次缺陷：模板里的 `{detail}` 会原样打进告警。
        const dropped = formatDiagnostic(
            { ...row, severity: 'warning', args: undefined },
            { locale: 'zh-CN', catalog: zh },
        );
        expect(dropped).toContain('{detail}');
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

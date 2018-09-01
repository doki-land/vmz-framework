/**
 * Delivery profile normalize + select (B0).
 */
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { BUILTIN_PROFILES, normalizeDeliveryAuthoring, selectBuildProfile, semanticIdsForAssembly, defineSite } from 'vmz';

describe('delivery profiles (B0)', () => {
    it('defaults to builtins with web-ssr', () => {
        const norm = normalizeDeliveryAuthoring(null);
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        expect(norm.table.default).toBe('web-ssr');
        expect(norm.table.profiles.static.assembly).toBe('static-cdn');
        const sel = selectBuildProfile(norm.table, '');
        expect(sel.ok).toBe(true);
        if (!sel.ok) return;
        expect(sel.selection.profileId).toBe('web-ssr');
        expect(sel.selection.assembly).toBe('server-host');
    });

    it('selects --profile static from builtins', () => {
        const norm = normalizeDeliveryAuthoring(null);
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        const sel = selectBuildProfile(norm.table, 'static');
        expect(sel.ok).toBe(true);
        if (!sel.ok) return;
        expect(sel.selection.assembly).toBe('static-cdn');
        expect(semanticIdsForAssembly(sel.selection.assembly)).toContain('static-delivery');
    });

    it('rejects unknown profile', () => {
        const norm = normalizeDeliveryAuthoring(null);
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        const sel = selectBuildProfile(norm.table, 'nope');
        expect(sel.ok).toBe(false);
    });

    it('expands legacy site sugar into rust-embedded profile', () => {
        const sugar = defineSite({
            artifact: 'web-production',
            sources: [{ id: 'baseline', kind: 'embedded', artifact: 'baseline' }],
            resolution: { mode: 'release', fallback: ['baseline'] },
            activation: 'atomic',
        });
        const norm = normalizeDeliveryAuthoring(sugar);
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        expect(norm.table.sugar).toBe(true);
        expect(norm.table.default).toBe('web-production');
        expect(norm.table.profiles['web-production'].assembly).toBe('rust-embedded');
        expect(norm.table.profiles['web-production'].sources).toBeTruthy();
        expect(Object.keys(BUILTIN_PROFILES).every((k) => norm.table.profiles[k])).toBe(true);
    });

    it('accepts named profiles map', () => {
        const norm = normalizeDeliveryAuthoring({
            default: 'web-client',
            profiles: {
                'web-client': { host: 'browser', assembly: 'local-static' },
            },
        });
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        expect(norm.table.default).toBe('web-client');
        const sel = selectBuildProfile(norm.table, '');
        expect(sel.ok).toBe(true);
        if (!sel.ok) return;
        expect(sel.selection.assembly).toBe('local-static');
    });

    it('keeps delivery.packaging.wechat as pure data', () => {
        const norm = normalizeDeliveryAuthoring({
            default: 'web-ssr',
            profiles: {
                'web-ssr': { host: 'browser', assembly: 'server-host', serverRuntime: 'node' },
            },
            packaging: {
                wechat: { appId: 'wx47094018073f0644', projectName: 'waitrose-vmz-shell', title: 'Waitrose' },
            },
        });
        expect(norm.ok).toBe(true);
        if (!norm.ok) return;
        expect(norm.table.packaging.wechat.appId).toBe('wx47094018073f0644');
        expect(norm.table.packaging.wechat.title).toBe('Waitrose');
    });

    it('rejects wx APIs / unknown packaging vendors', () => {
        const badVendor = normalizeDeliveryAuthoring({
            packaging: { alipay: { appId: 'x' } },
        });
        expect(badVendor.ok).toBe(false);
        const badField = normalizeDeliveryAuthoring({
            packaging: { wechat: { onShareAppMessage: 'nope' } },
        });
        expect(badField.ok).toBe(false);
    });
});

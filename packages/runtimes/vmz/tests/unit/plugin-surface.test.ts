/**
 * Surface ownership gate: the application config entry (`defineConfig`,
 * `VmzUserConfig`) lives on the `vmz` package; `@vmz/plugin` keeps the plugin
 * author surface (`definePlugin`, protocol types) only. No dual entry.
 */
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';

describe('plugin surface ownership', () => {
    it('@vmz/plugin keeps the plugin author surface', async () => {
        const plugin = await import('@vmz/plugin');
        expect(typeof plugin.definePlugin).toBe('function');
        expect(typeof plugin.contentHash).toBe('function');
        expect(typeof plugin.loadPluginSource).toBe('function');
        expect(typeof plugin.PLUGIN_PROTOCOL).toBe('string');
    });

    it('@vmz/plugin must not export defineConfig', async () => {
        const plugin = await import('@vmz/plugin');
        expect('defineConfig' in plugin).toBe(false);
    });

    it('vmz exports defineConfig as the application config entry', async () => {
        const vmz = await import('vmz');
        expect(typeof vmz.defineConfig).toBe('function');
        const cfg = vmz.defineConfig({ application: { id: 'surface-gate' } });
        expect(cfg.application?.id).toBe('surface-gate');
    });
});

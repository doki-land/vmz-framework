/**
 * `@vmz/commander` locales + parse/help coverage.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { expect } from '../../../../scripts/test/expect.mjs';
import {
    assertCatalogCoverage,
    clearLocalesCache,
    createCli,
    createLocalizeFromLocales,
    flattenCatalog,
    loadCatalog,
    loadLocalesManifest,
    translateWithFallback,
} from '@vmz/commander';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'locales');

describe('@vmz/commander locales + parse', () => {
    before(() => clearLocalesCache());
    after(() => clearLocalesCache());

    it('loadLocalesManifest + flattenCatalog + loadCatalog fallback chain', () => {
        const manifest = loadLocalesManifest(fixturesRoot);
        expect(manifest.defaultLocale).toBe('en-US');
        expect(flattenCatalog({ a: { b: 'x' } })).toEqual({ 'a.b': 'x' });
        expect(flattenCatalog({ 'a.b': 'x' })).toEqual({ 'a.b': 'x' });

        const en = loadCatalog('en-US', fixturesRoot);
        expect(en['cli.cmd.build']).toBe('Build the project');
        expect(en['commander.ui.usage']).toBe('USAGE {name}');

        const zh = loadCatalog('zh-CN', fixturesRoot);
        expect(zh['cli.cmd.build']).toBe('构建项目');
        expect(zh['cli.cmd.ping']).toBe('Ping'); // fallback en-US
    });

    it('translateWithFallback uses commander English when catalog omits id', () => {
        const s = translateWithFallback('commander.err.unknown_command', { cmd: 'nope' }, {});
        expect(s).toBe('unknown command `nope`');
        expect(translateWithFallback('missing.id', undefined, {})).toBe('{{missing.id}}');
    });

    it('.locales(root) derives help and uses commander.err for unknown command', async () => {
        const logs: string[] = [];
        const errs: string[] = [];
        const origLog = console.log;
        const origErr = console.error;
        console.log = (...a: unknown[]) => {
            logs.push(a.map(String).join(' '));
        };
        console.error = (...a: unknown[]) => {
            errs.push(a.map(String).join(' '));
        };
        try {
            const cli = createCli('my-cli').locales(fixturesRoot).intro('cli.intro');
            cli.command('build', 'cli.cmd.build')
                .option('--out-dir <dir>', 'cli.opt.out-dir')
                .action(() => 0);

            const helpCode = await cli.parse(['help']);
            expect(helpCode).toBe(0);
            const help = logs.join('\n');
            expect(help).toContain('my-cli demo');
            expect(help).toContain('USAGE my-cli'); // product overrides commander.ui.usage
            expect(help).toContain('Build the project');
            expect(help).toContain('--locale');

            logs.length = 0;
            errs.length = 0;
            const bad = await cli.parse(['nope']);
            expect(bad).toBe(1);
            expect(errs.join('\n')).toContain('unknown command `nope`');
        } finally {
            console.log = origLog;
            console.error = origErr;
        }
    });

    it('later .use overrides .locales', async () => {
        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...a: unknown[]) => {
            logs.push(a.map(String).join(' '));
        };
        try {
            const cli = createCli('x')
                .locales(fixturesRoot)
                .use({
                    t: (id) => (id === 'cli.intro' ? 'OVERRIDE' : `{{${id}}}`),
                })
                .intro('cli.intro');
            cli.command('ping', 'cli.cmd.ping').action(() => 0);
            await cli.parse(['help']);
            expect(logs.join('\n')).toContain('OVERRIDE');
            // commander fallback still fills chrome after wrap
            expect(logs.join('\n')).toMatch(/Usage:/);
        } finally {
            console.log = origLog;
        }
    });

    it('createLocalizeFromLocales + assertCatalogCoverage', () => {
        const plugin = createLocalizeFromLocales({ root: fixturesRoot, locale: 'en-US' });
        expect(plugin.t('cli.cmd.build')).toBe('Build the project');
        expect(plugin.t('commander.err.unknown_option', { option: '--x' })).toBe(
            'unknown option `--x`',
        );

        const cli = createCli('cov').locales(fixturesRoot).intro('cli.intro');
        cli.command('build', 'cli.cmd.build')
            .option('--out-dir <dir>', 'cli.opt.out-dir')
            .action(() => 0);
        assertCatalogCoverage(cli, loadCatalog('en-US', fixturesRoot));

        expect(() =>
            assertCatalogCoverage(cli, { 'cli.intro': 'x', 'cli.cmd.build': 'y' }),
        ).toThrow(/catalog missing help ids/);
    });
});

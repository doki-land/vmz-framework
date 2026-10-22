/**
 * Error contract tests for `@vmz/commander`.
 *
 * Parse / validation errors MUST surface as exit code 2 and deliver a structured
 * CommandDiagnostic to `onDiagnostic`. Action-handler failures remain exit code 1.
 * CliError replaces the fragile `throw new Error('prefix:detail')` convention.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli, CliError, parseOptions, peelKnownOptions } from '../src/index.ts';

function mockCli() {
    return createCli('tester').use({
        t: (id) => id, // pass-through so code is visible in assertions
    });
}

function collect(cli: ReturnType<typeof createCli>) {
    const received: Array<Record<string, unknown>> = [];
    cli.onDiagnostic((d) => received.push(d as Record<string, unknown>));
    return received;
}

test('CliError contract — parse errors carry exit code 2', () => {
    const err = CliError.parseError('commander::unknown_option', { option: '--foo' });
    assert.equal(err.exitCode, 2);
    assert.equal(err.code, 'commander::unknown_option');
    assert.deepEqual(err.args, { option: '--foo' });
    assert.ok(err instanceof Error);
});

test('CliError contract — factory/config errors carry exit code 1', () => {
    const err = CliError.configError('commander::invalid_option_raw', { raw: '--foo=bar' });
    assert.equal(err.exitCode, 1);
    assert.equal(err.code, 'commander::invalid_option_raw');
});

test('parseOptions strict mode throws CliError on unknown / missing', () => {
    let unknown: unknown;
    try { parseOptions(['--nope'], []); } catch (e) { unknown = e; }
    assert.ok(unknown instanceof CliError, `expected CliError, got ${unknown && (unknown as any).constructor?.name}`);
    assert.equal((unknown as CliError).exitCode, 2);
    assert.ok(String((unknown as CliError).code).includes('unknown_option'));

    let missing: unknown;
    try {
        parseOptions(
            ['--count'],
            [{
                rawName: '--count <n>',
                helpId: 'h',
                key: 'count',
                aliases: ['count'],
                takesValue: true,
                optionalValue: false,
                repeatable: false,
            }],
        );
    } catch (e) { missing = e; }
    assert.ok(missing instanceof CliError);
    assert.equal((missing as CliError).exitCode, 2);
    assert.ok(String((missing as CliError).code).includes('missing_option_value'));
});

test('peelKnownOptions non-strict keeps unknown flags in rest (no throw)', () => {
    const by = peelKnownOptions(['--nope', 'value', '--count', '3'], [{
        rawName: '--count <n>',
        helpId: 'h',
        key: 'count',
        aliases: ['count'],
        takesValue: true,
        optionalValue: false,
        repeatable: false,
    }]);
    assert.deepEqual(by.options, { _: [], count: '3' });
    assert.deepEqual(by.rest, ['--nope', 'value']);
});

test('unknown command → exit code 2 + onDiagnostic', async () => {
    const cli = mockCli();
    const received = collect(cli);
    const code = await cli.parse(['nope']);
    assert.equal(code, 2);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.code, 'commander::unknown_command');
});

test('unknown option → exit code 2 + onDiagnostic', async () => {
    const cli = mockCli();
    cli.command('run', 'cmd.run').action(() => 0);
    const received = collect(cli);
    const code = await cli.parse(['run', '--nope']);
    assert.equal(code, 2);
    assert.equal(received[0]!.code, 'commander::unknown_option');
});

test('missing option value → exit code 2 + onDiagnostic', async () => {
    const cli = mockCli();
    cli.command('run', 'cmd.run').option('--count <n>', 'opt.count').action(() => 0);
    const received = collect(cli);
    const code = await cli.parse(['run', '--count']);
    assert.equal(code, 2);
    assert.equal(received[0]!.code, 'commander::missing_option_value');
});

test('nested unknown subcommand → exit code 2', async () => {
    const cli = mockCli();
    cli.command('build', 'cmd.build'); // middle node — no action, has children
    const received = collect(cli);
    const code = await cli.parse(['build', 'weird']);
    assert.equal(code, 2);
    assert.equal(received[0]!.code, 'commander::unknown_command');
});

test('action-handler failure stays exit code 1 (not 2)', async () => {
    const cli = mockCli();
    cli.command('boom', 'cmd.boom').action(() => { throw new Error('nuclear'); });
    const received = collect(cli);
    const code = await cli.parse(['boom']);
    assert.equal(code, 1);
    assert.equal(received[0]!.code, 'commander::action_failed');
});

test('action-handler failure preserves error text in args for catalog templates', async () => {
    // 产品 catalog 模板常用 {message} 或 {detail} 占位符，正文必须在 args 里
    // 而不是只放在 diagnostic.message 字段里（渲染器只做 template + args 替换）
    const cli = mockCli();
    cli.command('boom', 'cmd.boom').action(() => { throw new Error('reactor meltdown'); });
    const received = collect(cli);
    await cli.parse(['boom']);
    const args = (received[0]! as any).args as Record<string, string>;
    assert.ok(args, 'args should exist');
    assert.equal(args.message, 'reactor meltdown', 'args.message must carry the error text');
    assert.equal(args.detail, 'reactor meltdown', 'args.detail must also carry it for templates using {detail}');
    // diagnostic.message 字段也保留，给没有 catalog 的兜底渲染器用
    assert.equal((received[0]! as any).message, 'reactor meltdown');
});

test('action-handler returns number exit code wins over framework default', async () => {
    const cli = mockCli();
    cli.command('skip', 'cmd.skip').action(() => 7);
    const code = await cli.parse(['skip']);
    assert.equal(code, 7);
});

test('root factory errors are CliError (exit code 1) — not thrown during parse', () => {
    // createCli(null) → config error at construction time
    assert.throws(() => createCli(''), (err) => {
        assert.ok(err instanceof CliError);
        assert.equal((err as CliError).exitCode, 1);
        assert.equal((err as CliError).code, 'commander::config::invalid_cli_name');
        return true;
    });
});

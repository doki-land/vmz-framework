/**
 * Action registration contract: every registered handler must be executable.
 *
 * `.actionCtx()` is the preferred handler API and must not fall into the
 * "no action registered" help fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli } from '../src/index.ts';

function mockCli() {
    return createCli('tester').use({
        t: (id) => id, // pass-through so ids stay visible
    });
}

test('a command with only .actionCtx() is executable', async () => {
    const cli = mockCli();
    const calls: Array<{ options: unknown; ctx: unknown }> = [];
    cli.command('run', 'cmd.run').actionCtx((options, args, ctx) => {
        calls.push({ options, ctx });
        void args;
        return 0;
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    try {
        assert.equal(await cli.parse(['run']), 0);
    } finally {
        console.log = origLog;
    }

    assert.equal(calls.length, 1, 'actionCtx handler must run once');
    assert.deepEqual(calls[0]!.options, { _: [] });
    assert.deepEqual((calls[0]!.ctx as { commandName: string }).commandName, 'run');
    assert.deepEqual(logs, [], 'help must not be printed for an executable command');
});

test('a command with only .actionCtx() returns the handler exit code', async () => {
    const cli = mockCli();
    let called = 0;
    cli.command('skip', 'cmd.skip').actionCtx(() => {
        called += 1;
        return 7;
    });

    assert.equal(await cli.parse(['skip']), 7);
    assert.equal(called, 1);
});

test('.actionCtx() receives parsed options and positionals', async () => {
    const cli = mockCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--profile <name>', 'opt.profile')
        .actionCtx((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--profile', 'prod', 'file.vmz']), 0);
    assert.deepEqual(seen, { _: ['file.vmz'], profile: 'prod' });
});

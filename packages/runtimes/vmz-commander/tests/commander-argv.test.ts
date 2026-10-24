/**
 * `--` boundary contract.
 *
 * Tokens after `--` are raw positionals: they must never be parsed as options,
 * must never trigger help, and must survive the early global-option peel so the
 * action still receives them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli } from '../src/index.ts';

function mockCli() {
    return createCli('tester').use({
        t: (id) => id,
    });
}

test('tokens after `--` are positionals, not options', async () => {
    const cli = mockCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--profile <name>', 'opt.profile')
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--', '--profile', 'prod']), 0);
    assert.deepEqual(seen, { _: ['--profile', 'prod'] });
});

test('`--help` after `--` reaches the action instead of printing help', async () => {
    const cli = mockCli();
    let seen: unknown;
    let called = 0;
    cli.command('run', 'cmd.run').action((options) => {
        called += 1;
        seen = options;
        return 0;
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    try {
        assert.equal(await cli.parse(['run', '--', '--help']), 0);
    } finally {
        console.log = origLog;
    }

    assert.equal(called, 1, 'action must run');
    assert.deepEqual(seen, { _: ['--help'] });
    assert.deepEqual(logs, [], 'help must not be printed');
});

test('options before and after `--` stay separate', async () => {
    const cli = mockCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--profile <name>', 'opt.profile')
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--profile', 'prod', '--', '--profile', 'staging']), 0);
    assert.deepEqual(seen, { _: ['--profile', 'staging'], profile: 'prod' });
});

test('positionals on both sides of `--` merge in order', async () => {
    const cli = mockCli();
    let seen: unknown;
    cli.command('run', 'cmd.run').action((options) => {
        seen = options;
        return 0;
    });

    assert.equal(await cli.parse(['run', 'src', '--', '--literal', 'out']), 0);
    assert.deepEqual(seen, { _: ['src', '--literal', 'out'] });
});

test('help still works when `--help` appears before `--`', async () => {
    const cli = mockCli();
    let called = 0;
    cli.command('run', 'cmd.run').action(() => {
        called += 1;
        return 0;
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    try {
        assert.equal(await cli.parse(['run', '--help', '--', '--help']), 0);
    } finally {
        console.log = origLog;
    }

    assert.equal(called, 0);
    assert.ok(logs.length > 0, 'head help token must print command help');
});

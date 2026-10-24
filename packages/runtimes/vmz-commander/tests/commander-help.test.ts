/**
 * Help-target contract for nested command trees.
 *
 * `demo document check --help` and `help document check` must resolve to the
 * same node, and help markers after `--` must never take over the action.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli } from '../src/index.ts';

function mockCli() {
    return createCli('tester').use({
        t: (id) => id,
    });
}

function capture() {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    return {
        logs,
        restore() {
            console.log = origLog;
        },
    };
}

function nestedCli() {
    const cli = mockCli();
    let calls = 0;
    let seen: unknown;
    const document = cli.command('document', 'cmd.document');
    document.command('check', 'cmd.check').action((options) => {
        calls += 1;
        seen = options;
        return 0;
    });
    return { cli, calls: () => calls, seen: () => seen };
}

test('`document check --help` shows the deepest command help', async () => {
    const { cli } = nestedCli();
    const out = capture();
    try {
        assert.equal(await cli.parse(['document', 'check', '--help']), 0);
    } finally {
        out.restore();
    }
    const help = out.logs.join('\n');
    assert.ok(help.includes('tester document check'), `check help expected, got: ${help}`);
    assert.ok(!help.includes('tester document —'), 'parent help must not win');
});

test('`help document check` resolves to the same node as `document check --help`', async () => {
    const { cli } = nestedCli();
    const out = capture();
    let viaFlag = '';
    let viaHelp = '';
    try {
        await cli.parse(['document', 'check', '--help']);
        viaFlag = out.logs.join('\n');
        out.logs.length = 0;
        await cli.parse(['help', 'document', 'check']);
        viaHelp = out.logs.join('\n');
    } finally {
        out.restore();
    }
    assert.equal(viaHelp, viaFlag);
});

test('`document --help check` keeps help on the level where the marker appears', async () => {
    const { cli } = nestedCli();
    const out = capture();
    try {
        assert.equal(await cli.parse(['document', '--help', 'check']), 0);
    } finally {
        out.restore();
    }
    const help = out.logs.join('\n');
    assert.ok(help.includes('tester document —'), `document help expected, got: ${help}`);
});

test('nested `--help` after `--` is delivered to the action', async () => {
    const { cli, calls, seen } = nestedCli();
    const out = capture();
    try {
        assert.equal(await cli.parse(['document', 'check', '--', '--help']), 0);
    } finally {
        out.restore();
    }
    assert.equal(calls(), 1);
    assert.deepEqual(seen(), { _: ['--help'] });
    assert.deepEqual(out.logs, [], 'help must not be printed');
});

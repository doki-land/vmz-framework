/**
 * `.option(..., config)` runtime contract.
 *
 * Every declared `OptionConfig` field must affect parsing or help — storing it
 * without consuming it is not a supported state.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli, parseOptions } from '../src/index.ts';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'locales');

function plainCli() {
    return createCli('tester').use({
        t: (id) => id,
    });
}

function capture() {
    const logs: string[] = [];
    const errs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    console.error = (...a: unknown[]) => errs.push(a.map(String).join(' '));
    return {
        logs,
        errs,
        restore() {
            console.log = origLog;
            console.error = origErr;
        },
    };
}

function diagnose(cli: ReturnType<typeof createCli>) {
    const received: Array<Record<string, unknown>> = [];
    cli.onDiagnostic((d) => received.push(d as Record<string, unknown>));
    return received;
}

test('required option missing → exit 2 before action', async () => {
    const cli = plainCli();
    let called = 0;
    cli.command('run', 'cmd.run')
        .option('--profile <name>', 'opt.profile', { required: true })
        .action(() => {
            called += 1;
            return 0;
        });
    const received = diagnose(cli);

    assert.equal(await cli.parse(['run']), 2);
    assert.equal(called, 0);
    assert.equal(received[0]!.code, 'commander::missing_required_option');
    assert.equal((received[0]!.args as Record<string, string>).option, 'profile');
});

test('required option supplied reaches the action', async () => {
    const cli = plainCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--profile <name>', 'opt.profile', { required: true })
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--profile', 'prod']), 0);
    assert.deepEqual(seen, { _: [], profile: 'prod' });
});

test('enum rejects values outside the allowed set before action', async () => {
    const cli = plainCli();
    let called = 0;
    cli.command('run', 'cmd.run')
        .option('--level <level>', 'opt.level', { enum: ['info', 'warn'] })
        .action(() => {
            called += 1;
            return 0;
        });
    const received = diagnose(cli);

    assert.equal(await cli.parse(['run', '--level', 'debug']), 2);
    assert.equal(called, 0);
    assert.equal(received[0]!.code, 'commander::option_not_in_enum');
    assert.deepEqual(received[0]!.args, { option: 'level', value: 'debug', allowed: 'info, warn', cmd: 'run' });
});

test('enum accepts allowed values and validates repeatable arrays', async () => {
    const cli = plainCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--tag <t>...', 'opt.tag', { enum: ['a', 'b'] })
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--tag', 'a', '--tag', 'b']), 0);
    assert.deepEqual(seen, { _: [], tag: ['a', 'b'] });

    assert.equal(await cli.parse(['run', '--tag', 'a', '--tag', 'z']), 2);
});

test('default fills missing options for boolean, string, and array values', async () => {
    const cli = plainCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--release', 'opt.release', { default: false })
        .option('--profile <name>', 'opt.profile', { default: 'dev' })
        .option('--tag <t>...', 'opt.tag', { default: ['a', 'b'] })
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run']), 0);
    assert.deepEqual(seen, { _: [], release: false, profile: 'dev', tag: ['a', 'b'] });
});

test('explicit values override defaults', async () => {
    const cli = plainCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--release', 'opt.release', { default: false })
        .option('--profile <name>', 'opt.profile', { default: 'dev' })
        .option('--tag <t>...', 'opt.tag', { default: ['a', 'b'] })
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--release', '--profile', 'prod', '--tag', 'x']), 0);
    assert.deepEqual(seen, { _: [], release: true, profile: 'prod', tag: ['x'] });
});

test('coerce transforms the raw value', async () => {
    const cli = plainCli();
    let seen: unknown;
    cli.command('run', 'cmd.run')
        .option('--port <n>', 'opt.port', { coerce: (raw) => Number(raw) })
        .action((options) => {
            seen = options;
            return 0;
        });

    assert.equal(await cli.parse(['run', '--port', '3000']), 0);
    assert.deepEqual(seen, { _: [], port: 3000 });
});

test('coerce failure → exit 2 with structured diagnostic', async () => {
    const cli = plainCli();
    let called = 0;
    cli.command('run', 'cmd.run')
        .option('--port <n>', 'opt.port', {
            coerce: (raw) => {
                if (raw === 'bad') throw new Error('not a number');
                return Number(raw);
            },
        })
        .action(() => {
            called += 1;
            return 0;
        });
    const received = diagnose(cli);

    assert.equal(await cli.parse(['run', '--port', 'bad']), 2);
    assert.equal(called, 0);
    assert.equal(received[0]!.code, 'commander::option_coerce_failed');
    assert.deepEqual(received[0]!.args, { option: 'port', value: 'bad', detail: 'not a number', cmd: 'run' });
});

test('parseOptions itself applies defaults and validation', () => {
    const defs = [{
        rawName: '--profile <name>',
        helpId: 'opt.profile',
        key: 'profile',
        aliases: ['profile'],
        takesValue: true,
        optionalValue: false,
        repeatable: false,
        config: { default: 'dev', enum: ['dev', 'prod'] },
    }];

    assert.deepEqual(parseOptions([], defs), { _: [], profile: 'dev' });
    assert.throws(() => parseOptions(['--profile', 'nope'], defs));
});

test('hidden options stay parseable but are absent from help', async () => {
    const cli = createCli('tester').locales(fixturesRoot);
    let seen: unknown;
    cli.command('run', 'cli.cmd.build')
        .option('--secret <value>', 'cli.opt.out-dir', { hidden: true })
        .action((options) => {
            seen = options;
            return 0;
        });

    const out = capture();
    try {
        assert.equal(await cli.parse(['run', '--help']), 0);
        assert.ok(!out.logs.join('\n').includes('--secret'), 'hidden option must not appear in help');
    } finally {
        out.restore();
    }

    assert.equal(await cli.parse(['run', '--secret', 'x']), 0);
    assert.deepEqual(seen, { _: [], secret: 'x' });
});

test('example and deprecated annotations appear in help', async () => {
    const cli = createCli('tester').locales(fixturesRoot);
    cli.command('run', 'cli.cmd.build')
        .option('--profile <name>', 'cli.opt.out-dir', { example: 'prod', deprecated: true })
        .action(() => 0);

    const out = capture();
    try {
        assert.equal(await cli.parse(['run', '--help']), 0);
        const help = out.logs.join('\n');
        assert.ok(help.includes('--profile <name>'), 'option name must render');
        assert.ok(help.includes('(e.g. prod)'), 'example annotation must render');
        assert.ok(help.includes('(deprecated)'), 'deprecation annotation must render');
    } finally {
        out.restore();
    }
});

test('deprecated option emits a warning diagnostic without blocking the action', async () => {
    const cli = plainCli();
    let called = 0;
    cli.command('run', 'cmd.run')
        .option('--old', 'opt.old', { deprecated: true })
        .action(() => {
            called += 1;
            return 0;
        });
    const received = diagnose(cli);

    assert.equal(await cli.parse(['run', '--old']), 0);
    assert.equal(called, 1);
    const warning = received.find((d) => d.code === 'commander::option_deprecated');
    assert.ok(warning, 'deprecation warning must be emitted');
    assert.equal(warning!.severity, 'warning');
    assert.deepEqual(warning!.args, { option: 'old' });
});

test('grouped options render under their own section with the default section kept', async () => {
    const cli = createCli('tester').locales(fixturesRoot);
    cli.command('run', 'cli.cmd.build')
        .option('--plain', 'cli.opt.out-dir')
        .option('--profile <name>', 'cli.opt.out-dir', { group: 'Advanced' })
        .action(() => 0);

    const out = capture();
    try {
        assert.equal(await cli.parse(['run', '--help']), 0);
        const help = out.logs.join('\n');
        assert.ok(help.includes('Options:'), 'ungrouped options keep the default section');
        assert.ok(help.includes('Advanced'), 'group header must render');
        assert.ok(help.indexOf('Options:') < help.indexOf('Advanced'), 'default section comes first');
        assert.ok(help.indexOf('--plain') < help.indexOf('Advanced'), 'ungrouped option stays in the default section');
    } finally {
        out.restore();
    }
});

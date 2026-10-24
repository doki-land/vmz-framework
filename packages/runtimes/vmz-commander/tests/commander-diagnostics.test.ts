/**
 * Default diagnostic rendering (no product handler).
 *
 * Framework chrome must stay interpolated from the catalog, point hints at the
 * full executable command, and route hint text through `t` so product catalogs
 * can translate it.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCli } from '../src/index.ts';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'locales');

function captureErrors() {
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => errs.push(a.map(String).join(' '));
    return {
        errs,
        restore() {
            console.error = origErr;
        },
    };
}

function localizedCli(name = 'demo') {
    return createCli(name).locales(fixturesRoot, { envKeys: [] });
}

test('default output interpolates the offending token from the catalog', async () => {
    const cli = localizedCli();
    cli.command('run', 'cli.cmd.build').action(() => 0);
    const out = captureErrors();
    try {
        assert.equal(await cli.parse(['run', '--oops']), 2);
    } finally {
        out.restore();
    }
    const text = out.errs.join('\n');
    assert.ok(text.includes('`--oops`'), `diagnostic must include the token, got: ${text}`);
    assert.ok(text.includes("Run 'demo run --help' for available options."), `hint must include program and command, got: ${text}`);
});

test('unknown command hint points at the root command', async () => {
    const cli = localizedCli();
    cli.command('run', 'cli.cmd.build').action(() => 0);
    const out = captureErrors();
    try {
        assert.equal(await cli.parse(['nope']), 2);
    } finally {
        out.restore();
    }
    const text = out.errs.join('\n');
    assert.ok(text.includes('unknown command `nope`'), `message expected, got: ${text}`);
    assert.ok(text.includes("Run 'demo --help' for available options."), `root hint expected, got: ${text}`);
});

test('hint text goes through the localize plugin so products can override it', async () => {
    const cli = createCli('demo').use({
        t: (id, args) => {
            if (id === 'commander.ui.hint.available_options') return `HINT:${args?.command}`;
            if (id === 'commander.ui.hint.did_you_mean') return `MAYBE:${args?.suggest}`;
            return `{{${id}}}`;
        },
    });
    cli.command('run', 'cmd.run').action(() => 0);
    cli.command('build', 'cmd.build').action(() => 0);

    const optionOut = captureErrors();
    try {
        assert.equal(await cli.parse(['run', '--oops']), 2);
    } finally {
        optionOut.restore();
    }
    assert.ok(optionOut.errs.join('\n').includes('HINT:demo run'), optionOut.errs.join('\n'));

    const commandOut = captureErrors();
    try {
        assert.equal(await cli.parse(['buid']), 2);
    } finally {
        commandOut.restore();
    }
    const text = commandOut.errs.join('\n');
    assert.ok(text.includes('MAYBE:build'), text);
});

test('a localized catalog supplies translated hint text', async () => {
    const catalog: Record<string, string> = {
        'commander.ui.hint.available_options': '运行 `{command} --help` 查看可用选项。',
        'commander.ui.hint.did_you_mean': '你是不是想用 `{suggest}`？',
    };
    const cli = createCli('demo').use({
        t: (id, args) => {
            const template = catalog[id];
            if (template == null) return `{{${id}}}`;
            return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name: string) => args?.[name] ?? `{${name}}`);
        },
    });
    cli.command('build', 'cmd.build').action(() => 0);

    const out = captureErrors();
    try {
        assert.equal(await cli.parse(['buid']), 2);
    } finally {
        out.restore();
    }
    const text = out.errs.join('\n');
    assert.ok(text.includes('运行 `demo --help` 查看可用选项。'), text);
    assert.ok(text.includes('你是不是想用 `build`？'), text);
});

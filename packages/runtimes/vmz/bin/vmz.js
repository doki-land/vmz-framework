#!/usr/bin/env node
const [major = 0, minor = 0] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));
if (major < 24 || (major === 24 && minor < 12)) {
    process.stderr.write(
        `vmz: Node >=24.12.0 is required (found ${process.versions.node}).\n` +
            '  Why: project `vmz.config.*` and plugin entries load through native ESM type stripping.\n',
    );
    process.exit(1);
}
const { runCli } = await import('../dist/cli/cli.js');
const code = await runCli(process.argv.slice(2));
process.exit(code ?? 0);

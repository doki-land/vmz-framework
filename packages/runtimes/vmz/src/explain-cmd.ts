/**
 * `vmz explain` — DX causal explain; registered on `@vmz/commander`.
 */

import type { Cli, ParsedOptions } from '@vmz/commander';
import { createWorkspace } from './index.js';
import { log } from './log.js';
import { resolveWorkspaceDirs } from './resolve.js';

export function registerExplainCommand(cli: Cli): void {
    cli.command('explain', 'cli.cmd.explain')
        .option('--json', 'cli.opt.json')
        .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
        .option('--target <id>', 'cli.opt.explain.target')
        .option('--path <dir>', 'cli.opt.root')
        .action((options) => cmdExplain(options));
}

export function cmdExplain(args: ParsedOptions): number {
    let target: string | undefined;
    let pathArg = '.';
    if (args._[0] === 'style') {
        const node = args._[1];
        if (!node) {
            log.errorId('cli.err.explain_style_usage');
            return 1;
        }
        target = `style:${node}`;
        pathArg = args._[2] ?? (typeof args.path === 'string' ? args.path : '.');
    } else if (args._[0]) {
        target = String(args._[0]);
        pathArg = args._[1] ?? (typeof args.path === 'string' ? args.path : '.');
    } else if (args.target) {
        target = String(args.target);
        pathArg = typeof args.path === 'string' ? args.path : '.';
    } else {
        log.errorId('cli.err.explain_usage');
        return 1;
    }

    const { project, outDir } = resolveWorkspaceDirs({
        path: String(pathArg),
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : 'dist',
    });
    const ws = createWorkspace({ root: project, outDir });
    if (typeof ws.explain !== 'function') {
        log.error('Workspace.explain unavailable (rebuild N-API)');
        return 1;
    }
    const raw = ws.explain(target);
    if (args.json) {
        console.log(raw);
        return 0;
    }
    let doc: {
        kind?: string;
        target?: string;
        notes?: string;
        chain?: Array<{
            from?: { kind?: string; id?: string };
            to?: { kind?: string; id?: string };
            reason?: string;
        }>;
    };
    try {
        doc = JSON.parse(raw);
    } catch {
        console.log(raw);
        return 0;
    }
    console.log(`explain kind=${doc.kind} target=${doc.target}`);
    if (doc.notes) console.log(`notes: ${doc.notes}`);
    const chain = Array.isArray(doc.chain) ? doc.chain : [];
    for (const e of chain) {
        const from = e.from ? `${e.from.kind}:${e.from.id}` : '?';
        const to = e.to ? `${e.to.kind}:${e.to.id}` : '?';
        console.log(` ${from} -> ${to} (${e.reason})`);
    }
    if (chain.length === 0) {
        console.log(' (empty chain)');
    }
    return 0;
}

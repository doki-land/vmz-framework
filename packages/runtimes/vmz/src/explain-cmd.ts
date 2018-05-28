// @ts-nocheck
/**
 * `vmz explain` — DX causal explain queries (doc 21).
 *
 * @param {string[]} argv args after `explain`
 */
import { createWorkspace } from './index.js';
import { log } from './log.js';
import { resolveWorkspaceDirs } from './resolve.js';

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function cmdExplain(argv) {
    const args = parse(argv);
    if (args.help || args._[0] === 'help') {
        printHelp();
        return 0;
    }

    let target;
    let pathArg = '.';
    if (args._[0] === 'style') {
        const node = args._[1];
        if (!node) {
            log.error('usage: vmz explain style <node> [path]');
            return 1;
        }
        target = `style:${node}`;
        pathArg = args._[2] ?? args.path ?? '.';
    } else if (args._[0]) {
        target = String(args._[0]);
        pathArg = args._[1] ?? args.path ?? '.';
    } else if (args.target) {
        target = String(args.target);
        pathArg = args.path ?? '.';
    } else {
        printHelp();
        return 1;
    }

    const { project, outDir } = resolveWorkspaceDirs({
        path: String(pathArg),
        outDir: args['out-dir'] ?? 'dist',
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
    let doc;
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
        console.log(`  ${from} -> ${to}  (${e.reason})`);
    }
    if (chain.length === 0) {
        console.log('  (empty chain)');
    }
    return 0;
}

function printHelp() {
    console.log(`vmz explain — causal explain (DX)

Usage:
  vmz explain style <node> [path]   Style Theme / style:tw / global styles
  vmz explain <target> [path]       Generic Workspace.explain target

Style nodes:
  bg-action | colors.action | --vmz-colors-action
  designs/styles/index.scss

Options:
  --json                 Print raw ExplainDocument JSON
  --out-dir, -o <dir>    Dist directory (default: dist)
`);
}

/**
 * @param {string[]} argv
 */
function parse(argv) {
    /** @type {Record<string, string | boolean> & { _: string[] }} */
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq !== -1) {
                out[a.slice(2, eq)] = a.slice(eq + 1);
                continue;
            }
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('-') && key !== 'json' && key !== 'help') {
                out[key] = next;
                i += 1;
            } else {
                out[key] = true;
            }
            continue;
        }
        out._.push(a);
    }
    return out;
}

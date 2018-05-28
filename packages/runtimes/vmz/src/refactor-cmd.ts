// @ts-nocheck
/**
 * `vmz refactor` — X1 RouteId/field safe rename (plan + atomic apply).
 */

import { createWorkspace } from './index.js';
import { log } from './log.js';
import { resolveWorkspaceDirs } from './resolve.js';

/**
 * @param {string[]} argv args after `refactor`
 * @returns {Promise<number>}
 */
export async function cmdRefactor(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
        printRefactorHelp();
        return 0;
    }
    if (sub === 'rename') {
        return cmdRename(rest);
    }
    log.error(`unknown refactor subcommand \`${sub}\``);
    printRefactorHelp();
    return 1;
}

function printRefactorHelp() {
    console.log(`vmz refactor — workspace edit plans (X1)

Usage:
  vmz refactor rename --kind <route_id|field|method|component|capability> --from <id> --to <id> [path]
                      [--scope <chunk>] [--json] [--apply] [--explain]

Notes:
  Returns WorkspaceEditPlan (\`vmz.dx.workspace_edit.v0\`).
  route_id / field emit proven TextEdits; --apply writes atomically when status=ready.
`);
}

/**
 * @param {string[]} argv
 */
function parseRefactorArgs(argv) {
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
            if (next && !next.startsWith('-')) {
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

/**
 * @param {string[]} argv
 */
function cmdRename(argv) {
    const args = parseRefactorArgs(argv);
    const kind = typeof args.kind === 'string' ? args.kind : '';
    const from = typeof args.from === 'string' ? args.from : '';
    const to = typeof args.to === 'string' ? args.to : '';
    const scope = typeof args.scope === 'string' ? args.scope : undefined;
    const wantJson = args.json === true || typeof args.json === 'string';
    const wantApply = args.apply === true;
    const wantExplain = args.explain === true;

    if (!kind || !from || !to) {
        log.error('rename requires --kind, --from, and --to');
        printRefactorHelp();
        return 1;
    }

    const pathArg = args._[0] ?? '.';
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });

    const intent = {
        schema: 'vmz.dx.rename.v0',
        kind,
        from,
        to,
        ...(scope ? { scope } : {}),
    };

    const ws = createWorkspace({ root: project, outDir });
    try {
        if (typeof ws.planRename !== 'function') {
            log.error('planRename missing on Workspace — rebuild native (`pnpm napi:build`)');
            return 1;
        }
        let planRaw = ws.planRename(JSON.stringify(intent));
        let plan;
        try {
            plan = JSON.parse(planRaw);
        } catch (e) {
            log.error(`plan_rename not JSON: ${e}`);
            return 1;
        }

        if (wantApply) {
            if (typeof ws.applyWorkspaceEdit !== 'function') {
                log.error('applyWorkspaceEdit missing — rebuild native (`pnpm napi:build`)');
                return 1;
            }
            planRaw = ws.applyWorkspaceEdit(planRaw);
            try {
                plan = JSON.parse(planRaw);
            } catch (e) {
                log.error(`apply_workspace_edit not JSON: ${e}`);
                return 1;
            }
        }

        if (wantExplain && typeof ws.explainRenameChain === 'function') {
            const explainRaw = ws.explainRenameChain(JSON.stringify(intent));
            if (wantJson) {
                console.log(JSON.stringify({ plan, explain: JSON.parse(explainRaw) }, null, 2));
                return plan.status === 'rejected' ? 1 : 0;
            }
            const explain = JSON.parse(explainRaw);
            log.info(`explain chain edges=${(explain.chain || []).length}`);
        }

        if (wantJson) {
            console.log(JSON.stringify(plan, null, 2));
        } else {
            log.info(`rename ${kind} \`${from}\` → \`${to}\` → ${plan.status}`);
            for (const p of plan.preconditions || []) {
                console.log(`  precondition: ${p}`);
            }
            for (const e of plan.edits || []) {
                console.log(`  edit ${e.path} @${e.start}..${e.end} → ${JSON.stringify(e.newText)}`);
            }
            for (const d of plan.diagnostics || []) {
                console.log(`  ${d.severity || 'info'}: ${d.message}`);
            }
            if ((plan.edits || []).length === 0) {
                console.log('  edits: (none)');
            }
        }

        return plan.status === 'rejected' ? 1 : 0;
    } finally {
        ws.dispose();
    }
}

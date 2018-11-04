// @ts-nocheck
/**
 * `vmz refactor` — registered on `@vmz/commander`.
 */

import { createWorkspace } from './index.js';
import { log } from './log.js';
import { resolveWorkspaceDirs } from './resolve.js';

/**
 * @param {import('@vmz/commander').Command} parent
 */
export function registerRefactorCommands(parent) {
    parent
        .command('rename', 'cli.cmd.refactor.rename')
        .option('--kind <kind>', 'cli.opt.refactor.kind')
        .option('--from <id>', 'cli.opt.refactor.from')
        .option('--to <id>', 'cli.opt.refactor.to')
        .option('--scope <chunk>', 'cli.opt.refactor.scope')
        .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
        .option('--json [file]', 'cli.opt.json')
        .option('--apply', 'cli.opt.apply')
        .option('--explain', 'cli.opt.explain')
        .action((options) => cmdRename(options));
}

/** @param {import('@vmz/commander').ParsedOptions} args */
function cmdRename(args) {
    const kind = typeof args.kind === 'string' ? args.kind : '';
    const from = typeof args.from === 'string' ? args.from : '';
    const to = typeof args.to === 'string' ? args.to : '';
    const scope = typeof args.scope === 'string' ? args.scope : undefined;
    const wantJson = args.json === true || typeof args.json === 'string';
    const wantApply = args.apply === true;
    const wantExplain = args.explain === true;

    if (!kind || !from || !to) {
        log.errorId('cli.err.refactor_rename_usage');
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
                console.log(` precondition: ${p}`);
            }
            for (const e of plan.edits || []) {
                console.log(` edit ${e.path} @${e.start}..${e.end} → ${JSON.stringify(e.newText)}`);
            }
            log.diagnostics(plan.diagnostics || []);
            if ((plan.edits || []).length === 0) {
                console.log(' edits: (none)');
            }
        }

        return plan.status === 'rejected' ? 1 : 0;
    } finally {
        ws.dispose();
    }
}

/**
 * `vmz plan` — dump frozen Rust plans via N-API; registered on `@vmz/commander`.
 */

import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { loadDocumentRoutePlan, loadLocalePlan, mapPlanDiagnostics } from './author-input.js';
import { log } from './log.js';
import { emitPrettyJson } from './pretty-json.js';

export function registerPlanCommands(parent: Command): void {
    const withJson = (cmd: Command) => cmd.option('--json [file]', 'cli.opt.json');

    withJson(parent.command('locale', 'cli.cmd.plan.locale')).action((options) => runPlanKind('locale', options));
    withJson(parent.command('document-route|document_route', 'cli.cmd.plan.document-route')).action((options) =>
        runPlanKind('document-route', options),
    );
}

export function runPlanKind(kind: 'locale' | 'document-route', options: ParsedOptions): number {
    const rootArg = typeof options._[0] === 'string' ? options._[0] : '.';
    const root = path.resolve(rootArg);

    let plan;
    switch (kind) {
        case 'locale':
            plan = loadLocalePlan(root);
            break;
        case 'document-route':
            plan = loadDocumentRoutePlan(root);
            break;
        default:
            log.errorId('cli.err.unknown_plan_kind', { kind: String(kind) });
            return 1;
    }

    const diagnostics = mapPlanDiagnostics(plan?.diagnostics || []);
    const hardErrors = diagnostics.filter((d) => d.severity === 'error');
    if (diagnostics.length) {
        log.diagnostics(diagnostics);
    }

    emitPrettyJson(typeof options.json === 'string' ? options.json : true, plan);

    return hardErrors.length ? 1 : 0;
}

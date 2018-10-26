// @ts-nocheck
/**
 * `vmz plan` — dump frozen Rust plans as canonical JSON via N-API.
 * Same loaders as Workspace / locale / document hosts (`loadLocalePlan` /
 * `loadDocumentRoutePlan`); no parallel Rust clap product surface.
 */

import path from 'node:path';
import { loadDocumentRoutePlan, loadLocalePlan, mapPlanDiagnostics } from './author-input.js';
import { parseArgs } from './cli.js';
import { vmzCliLocalize } from './cli-localize.js';
import { log } from './log.js';
import { emitPrettyJson } from './pretty-json.js';

function printPlanHelp() {
    console.log(vmzCliLocalize.t('cli.help.plan'));
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function cmdPlan(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
        printPlanHelp();
        return 0;
    }

    const args = parseArgs(rest);
    const rootArg = typeof args._[0] === 'string' ? args._[0] : '.';
    const root = path.resolve(rootArg);

    let plan;
    switch (sub) {
        case 'locale':
            plan = loadLocalePlan(root);
            break;
        case 'document-route':
        case 'document_route':
            plan = loadDocumentRoutePlan(root);
            break;
        default:
            log.errorId('cli.err.unknown_plan_kind', { kind: String(sub) });
            printPlanHelp();
            return 1;
    }

    const diagnostics = mapPlanDiagnostics(plan?.diagnostics || []);
    const hardErrors = diagnostics.filter((d) => d.severity === 'error');
    if (diagnostics.length) {
        log.diagnostics(diagnostics);
    }

    // Always emit plan body (stdout, or `--json <file>`).
    emitPrettyJson(typeof args.json === 'string' ? args.json : true, plan);

    return hardErrors.length ? 1 : 0;
}

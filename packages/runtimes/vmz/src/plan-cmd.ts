// @ts-nocheck
/**
 * `vmz plan` — dump frozen Rust plans as canonical JSON via N-API.
 * Invoked from the product `@vmz/commander` tree (`plan locale|document-route`).
 */

import path from 'node:path';
import { loadDocumentRoutePlan, loadLocalePlan, mapPlanDiagnostics } from './author-input.js';
import { parseArgs } from './cli.js';
import { log } from './log.js';
import { emitPrettyJson } from './pretty-json.js';

/**
 * @param {string[]} argv  kind + remaining tokens (from commander action)
 * @returns {number}
 */
export function cmdPlan(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
        // Commander prints command help for `vmz plan` / `vmz plan help`;
        // keep a tiny fallback when called directly in tests.
        console.log('vmz plan locale|document-route [root] [--json [file]]');
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
            return 1;
    }

    const diagnostics = mapPlanDiagnostics(plan?.diagnostics || []);
    const hardErrors = diagnostics.filter((d) => d.severity === 'error');
    if (diagnostics.length) {
        log.diagnostics(diagnostics);
    }

    emitPrettyJson(typeof args.json === 'string' ? args.json : true, plan);

    return hardErrors.length ? 1 : 0;
}

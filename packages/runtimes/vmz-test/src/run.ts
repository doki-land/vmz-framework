/**
 * Programmatic entry: run manifests without CLI discovery automation.
 */

import path from 'node:path';
import { buildForCompile, runCompileManifest, type BuildOptions, type CompileResult } from './compile.js';
import { runLogicManifest, type LogicResult } from './logic.js';
import { buildTestReport, type TestMode } from './protocol.js';

export type RunManifestOptions = BuildOptions & {
    outDir?: string;
    modes?: TestMode[];
    /** When true, skip build and use existing outDir. */
    reuseOutDir?: boolean;
};

export type ManifestRunResult = {
    testId: string;
    status: string;
    diagnostics: unknown[];
    programId: string | null;
    planId: string | null;
    compile?: CompileResult;
    logic?: LogicResult;
    outDir: string | null;
};

/** Run a single manifest object (no discovery). Caller supplies project root for build. */
export async function runManifest(
    manifest: Record<string, unknown>,
    projectRoot: string,
    options: RunManifestOptions = {},
): Promise<ManifestRunResult> {
    const testId = String(manifest.id || 'anonymous');
    const mModes = Array.isArray(manifest.modes) ? manifest.modes.map(String) : [];
    const active = options.modes?.length ? options.modes : (['all'] as TestMode[]);
    const modeActive = (name: string) => active.includes('all') || active.includes(name as TestMode);
    const doCompile = mModes.includes('compile') && modeActive('compile');
    const doLogic = mModes.includes('logic') && modeActive('logic');

    let outDir = options.outDir ?? null;
    if ((doCompile || doLogic) && !options.reuseOutDir) {
        const built = buildForCompile(projectRoot, options.outDir, options);
        outDir = built.outDir;
        if (!built.ok) {
            return {
                testId,
                status: 'error',
                diagnostics: [...built.diagnostics, { severity: 'error', message: built.error }],
                programId: null,
                planId: null,
                outDir,
            };
        }
    }

    if (!outDir && (doCompile || doLogic)) {
        return {
            testId,
            status: 'error',
            diagnostics: [{ severity: 'error', message: 'outDir unavailable' }],
            programId: null,
            planId: null,
            outDir: null,
        };
    }

    const diags: unknown[] = [];
    const statuses: string[] = [];
    let programId: string | null = null;
    let planId: string | null = null;
    let compile: CompileResult | undefined;
    let logic: LogicResult | undefined;

    if (doCompile && outDir) {
        compile = runCompileManifest(manifest, { outDir });
        statuses.push(compile.status);
        diags.push(...compile.diagnostics);
        programId = compile.programId;
        planId = compile.planId;
    }
    if (doLogic && outDir) {
        logic = await runLogicManifest(manifest, { outDir });
        statuses.push(logic.status);
        diags.push(...logic.diagnostics);
        programId = logic.programId ?? programId;
        planId = logic.planId ?? planId;
    }

    let status = 'skipped';
    if (statuses.includes('error')) status = 'error';
    else if (statuses.includes('failed')) status = 'failed';
    else if (statuses.length && statuses.every((s) => s === 'passed')) status = 'passed';
    else if (!doCompile && !doLogic) status = 'skipped';

    return {
        testId,
        status,
        diagnostics: diags,
        programId,
        planId,
        compile,
        logic,
        outDir,
    };
}

/** Convenience: build report skeleton from runManifest results. */
export function resultsToReport(project: string, modes: TestMode[], results: ManifestRunResult[], files: Record<string, string> = {}) {
    return buildTestReport({
        project: path.relative(process.cwd(), project) || '.',
        modes,
        tests: results.map((r) => ({
            testId: r.testId,
            file: files[r.testId] || '',
            modes: [],
            programId: r.programId,
            planId: r.planId,
            status: r.status,
            diagnostics: r.diagnostics,
        })),
        status: results.some((r) => r.status === 'failed' || r.status === 'error') ? 'failed' : results.length ? 'passed' : 'empty',
    });
}

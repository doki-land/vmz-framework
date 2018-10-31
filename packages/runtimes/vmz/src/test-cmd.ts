// @ts-nocheck
/**
 * `vmz test` command — discovery / build / filter / TestReport orchestration.
 * Semantics live in `@vmz/test` (optional peer — not installed with bare `@vmz/vmz`).
 */

import path from 'node:path';
import { createWorkspace } from './index.js';
import { log } from './log.js';
import { generatePrettyJson } from './pretty-json.js';

/**
 * @param {import('@vmz/commander').Cli | import('@vmz/commander').Command} cli
 */
export function registerTestCommand(cli) {
    cli.command('test', 'cli.cmd.test')
        .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
        .option('--list', 'cli.opt.list')
        .option('--json [file]', 'cli.opt.json')
        .option('--mode <modes>', 'cli.opt.mode')
        .option('--filter <pattern>', 'cli.opt.filter')
        .option('--application <id>', 'cli.opt.application')
        .option('--mounted <id>', 'cli.opt.mounted')
        .option('--affected', 'cli.opt.affected')
        .option('--target <id>', 'cli.opt.target')
        .action((options) => cmdTest(options));
}

/**
 * @returns {Promise<typeof import('@vmz/test')>}
 */
async function loadTestPackage() {
    try {
        return await import('@vmz/test');
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
            '`vmz test` needs `@vmz/test` (optional peer of `@vmz/vmz`).\n' + '  Install:  pnpm add -D @vmz/test\n' + `  Detail: ${detail}`,
        );
    }
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 * @returns {Promise<number>}
 */
export async function cmdTest(args) {
    let test;
    try {
        test = await loadTestPackage();
    } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        return 1;
    }
    const {
        discoverTestManifests,
        buildTestReport,
        parseModes,
        buildForCompile,
        runCompileManifest,
        runLogicManifest,
        runSsrManifest,
        runResumeManifest,
        runBrowserManifest,
        runDeploymentManifest,
    } = test;

    const project = path.resolve(String(args._[0] || '.'));
    let modes;
    try {
        modes = parseModes(/** @type {string|boolean|undefined} */ (args.mode));
    } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        return 1;
    }

    const wantList = args.list === true;
    const wantJson = args.json === true || typeof args.json === 'string';
    const filter = typeof args.filter === 'string' && args.filter ? String(args.filter) : null;
    const outDirArg = typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined;
    const wantAffected = args.affected === true || args.target === 'changed' || args.target === 'affected';
    const applicationId = typeof args.application === 'string' && args.application ? String(args.application) : null;
    const mountedId = typeof args.mounted === 'string' && args.mounted ? String(args.mounted) : null;

    if (applicationId && mountedId) {
        log.error('use either --application <id> or --mounted <id>, not both');
        return 1;
    }

    const { manifests, errors } = discoverTestManifests(project);
    for (const err of errors) {
        log.error(err);
    }

    let selected = manifests;
    if (filter) {
        const re = (() => {
            try {
                return new RegExp(filter);
            } catch {
                return null;
            }
        })();
        selected = manifests.filter((m) => {
            const id = String(m.id || '');
            const file = String(m.file || '');
            if (re) return re.test(id) || re.test(file);
            return id.includes(filter) || file.includes(filter);
        });
    }

    const scopeId = applicationId || mountedId;
    if (scopeId) {
        const mode = applicationId ? 'application' : 'mounted';
        log.info(`test ${mode} scope: ApplicationId=${scopeId}` + (mountedId ? ' contracts=relocation,host_boundary' : ' scope=standalone'));
        selected = selected.filter((m) => {
            const app = (m.applicationId && String(m.applicationId)) || (m.application && String(m.application)) || '';
            const file = String(m.file || '');
            const id = String(m.id || '');
            if (app) return app === scopeId;
            return file.includes(scopeId) || id.includes(scopeId);
        });
    }

    /** @type {null | { schema: string, reason: string, testIds: string[], affectedChunkIds: string[], status: string }} */
    let testSelection = null;
    if (wantAffected) {
        const outDir = outDirArg ? path.resolve(outDirArg) : path.join(project, 'dist');
        const ws = createWorkspace({ root: project, outDir });
        try {
            if (typeof ws.selectTestsAffected !== 'function') {
                log.error('selectTestsAffected missing on Workspace — rebuild native (`pnpm napi:build`)');
                return 1;
            }
            const raw = ws.selectTestsAffected();
            try {
                testSelection = JSON.parse(raw);
            } catch (e) {
                log.error(`test selection not JSON: ${e}`);
                return 1;
            }
            log.info(
                `affected selection: ${testSelection.status} — ${testSelection.reason} (chunks=${(testSelection.affectedChunkIds || []).length})`,
            );
            const ids = new Set((testSelection.testIds || []).map(String));
            const chunks = new Set((testSelection.affectedChunkIds || []).map(String));
            if (ids.size > 0) {
                selected = selected.filter((m) => ids.has(String(m.id || '')));
            } else if (chunks.size > 0) {
                // Scaffold fallback: match manifest program.chunkId until graph->test edges exist.
                selected = selected.filter((m) => {
                    const program = m.program && typeof m.program === 'object' ? m.program : {};
                    const chunk = program.chunkId ? String(program.chunkId) : '';
                    return chunk && chunks.has(chunk);
                });
            } else {
                selected = [];
            }
        } finally {
            ws.dispose();
        }
    }

    if (modes.length === 1 && modes[0] !== 'all') {
        const mode = modes[0];
        selected = selected.filter((m) => Array.isArray(m.modes) && m.modes.includes(mode));
    } else if (!modes.includes('all')) {
        selected = selected.filter((m) => Array.isArray(m.modes) && m.modes.some((x) => modes.includes(x)));
    }

    /** @type {Array<{
     * testId: string,
     * file: string,
     * modes: string[],
     * programId: string|null,
     * planId: string|null,
     * status: string,
     * diagnostics: unknown[],
     * }>} */
    let tests;

    if (wantList) {
        tests = selected.map((m) => {
            const program = m.program && typeof m.program === 'object' ? m.program : {};
            const plan = m.plan && typeof m.plan === 'object' ? m.plan : {};
            return {
                testId: String(m.id),
                file: String(m.file),
                modes: Array.isArray(m.modes) ? m.modes.map(String) : [],
                programId: program.chunkId ? String(program.chunkId) : null,
                planId: plan.ref ? String(plan.ref) : plan.schema ? String(plan.schema) : null,
                status: 'listed',
                diagnostics: [],
            };
        });
    } else {
        const modeActive = (name) => modes.includes('all') || modes.includes(name);
        const needsBuild =
            selected.length > 0 &&
            selected.some((m) => {
                const mm = Array.isArray(m.modes) ? m.modes : [];
                return (
                    (mm.includes('compile') && modeActive('compile')) ||
                    (mm.includes('logic') && modeActive('logic')) ||
                    (mm.includes('ssr') && modeActive('ssr')) ||
                    (mm.includes('resume') && modeActive('resume')) ||
                    (mm.includes('browser') && modeActive('browser')) ||
                    (mm.includes('deployment') && modeActive('deployment'))
                );
            });

        /** @type {string|null} */
        let buildOut = null;
        /** @type {unknown[]} */
        let buildDiags = [];
        /** @type {string|null} */
        let buildError = null;

        if (needsBuild) {
            const built = buildForCompile(project, outDirArg ? path.resolve(outDirArg) : undefined, {
                createWorkspace,
            });
            buildOut = built.outDir;
            buildDiags = built.diagnostics || [];
            if (!built.ok) {
                buildError = built.error || 'build failed';
                log.error(buildError);
            }
        }

        tests = [];
        for (const m of selected) {
            const program = m.program && typeof m.program === 'object' ? m.program : {};
            const plan = m.plan && typeof m.plan === 'object' ? m.plan : {};
            const mModes = Array.isArray(m.modes) ? m.modes.map(String) : [];
            const base = {
                testId: String(m.id),
                file: String(m.file),
                modes: mModes,
                programId: program.chunkId ? String(program.chunkId) : null,
                planId: plan.ref ? String(plan.ref) : plan.schema ? String(plan.schema) : null,
                status: 'skipped',
                diagnostics: /** @type {unknown[]} */ ([]),
            };

            const doCompile = mModes.includes('compile') && modeActive('compile');
            const doLogic = mModes.includes('logic') && modeActive('logic');
            const doSsr = mModes.includes('ssr') && modeActive('ssr');
            const doResume = mModes.includes('resume') && modeActive('resume');
            const doBrowser = mModes.includes('browser') && modeActive('browser');
            const doDeployment = mModes.includes('deployment') && modeActive('deployment');

            if (!doCompile && !doLogic && !doSsr && !doResume && !doBrowser && !doDeployment) {
                base.status = 'skipped';
                base.diagnostics = [
                    {
                        severity: 'info',
                        message: `modes [${mModes.join(',')}] not executed in this vmz test slice`,
                    },
                ];
                tests.push(base);
                continue;
            }

            if (buildError || !buildOut) {
                base.status = 'error';
                base.diagnostics = [...buildDiags, { severity: 'error', message: buildError || 'build unavailable' }];
                tests.push(base);
                continue;
            }

            /** @type {unknown[]} */
            const diags = [];
            /** @type {string[]} */
            const statuses = [];

            if (doCompile) {
                const result = runCompileManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            if (doLogic) {
                const result = await runLogicManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            if (doSsr) {
                const result = await runSsrManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            if (doResume) {
                const result = await runResumeManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            if (doDeployment) {
                const result = runDeploymentManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            if (doBrowser) {
                const result = await runBrowserManifest(m, { outDir: buildOut });
                statuses.push(result.status);
                diags.push(...result.diagnostics);
                base.programId = result.programId ?? base.programId;
                base.planId = result.planId ?? base.planId;
            }

            base.diagnostics = diags;
            if (statuses.includes('error')) base.status = 'error';
            else if (statuses.includes('failed')) base.status = 'failed';
            else if (statuses.every((s) => s === 'passed')) base.status = 'passed';
            else base.status = statuses[0] || 'skipped';
            tests.push(base);
        }
    }

    const failed = tests.some((t) => t.status === 'failed' || t.status === 'error');
    const reportStatus = errors.length
        ? 'error'
        : wantList
          ? tests.length
              ? 'listed'
              : 'empty'
          : failed
            ? 'failed'
            : tests.length === 0
              ? 'empty'
              : 'passed';

    const report = buildTestReport({
        project: path.relative(process.cwd(), project) || '.',
        modes,
        tests,
        status: reportStatus,
    });

    if (wantList && !wantJson) {
        if (tests.length === 0) {
            console.log(`vmz test: no manifests under ${project}`);
        } else {
            console.log(`vmz test: ${tests.length} test(s) under ${project}`);
            for (const t of tests) {
                console.log(` ${t.testId}\t${t.file}\t[${t.modes.join(',')}]`);
            }
        }
        if (errors.length) {
            console.log(`vmz test: ${errors.length} manifest error(s)`);
        }
        return errors.length ? 2 : 0;
    }

    if (wantJson) {
        const text = `${generatePrettyJson(report)}\n`;
        if (typeof args.json === 'string' && args.json !== 'true') {
            const { writeFileSync } = await import('node:fs');
            writeFileSync(path.resolve(String(args.json)), text);
            if (!wantList) {
                console.log(`vmz test: wrote ${args.json}`);
            }
        } else {
            process.stdout.write(text);
        }
        if (errors.length) return 2;
        if (!wantList && failed) return 1;
        return 0;
    }

    console.log(`vmz test: ${tests.length} test(s) — ${reportStatus}`);
    for (const t of tests) {
        console.log(` ${t.status}\t${t.testId}\t${t.file}`);
        for (const d of t.diagnostics || []) {
            if (d && typeof d === 'object' && d.severity === 'error') {
                console.log(` ! ${d.message}`);
                if (process.env.GITHUB_ACTIONS === 'true') {
                    const msg = String(d.message || 'error').replace(/[\r\n]+/g, ' ');
                    console.log(`::error title=vmz test ${t.testId}::${msg}`);
                }
            }
        }
        if (
            process.env.GITHUB_ACTIONS === 'true' &&
            (t.status === 'failed' || t.status === 'error') &&
            !(t.diagnostics || []).some((d) => d && typeof d === 'object' && d.severity === 'error')
        ) {
            console.log(`::error title=vmz test ${t.testId}::status=${t.status}`);
        }
    }
    if (tests.length === 0) {
        console.log(' (add *.vmz.test.json manifests)');
    }
    if (errors.length) return 2;
    if (failed) return 1;
    return 0;
}

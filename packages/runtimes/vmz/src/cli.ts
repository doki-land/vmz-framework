// @ts-nocheck
/**
 * Node CLI command implementations .
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
    HOST_PROTOCOL,
    createWorkspace,
    getProtocolVersions,
    materializeServeHostRuntime,
    resolveCoreRuntimeDist,
    resolveNativePath,
} from './index.js';
import { createDevSession } from './dev-session.js';
import { gateGlobalProjectCommand, getInvocationContext, isGlobalAllowedCommand } from './invocation.js';
import { log } from './log.js';
import { findAvailablePort } from './port.js';
import { readPackageMeta, resolveWorkspaceDirs } from './resolve.js';
import { cmdTest } from './test-cmd.js';
import { cmdDocument } from './document-cmd.js';
import { buildIntegratedDocuments, projectHasDocuments } from './document-integrate.js';
import { cmdLocale } from './locale-cmd.js';
import { emitLocaleRuntimeModules, localeHasErrors } from './locale-check.js';
import { emitLocaleRouteRealization } from './locale-route-emit.js';
import { cmdApplication } from './application-cmd.js';
import { cmdArtifact } from './release-cmd.js';
import { cmdRefactor } from './refactor-cmd.js';
import { cmdExplain } from './explain-cmd.js';
import { cmdPlan } from './plan-cmd.js';
import { loadVmzConfig } from './plugin-host.js';
import { normalizeDeliveryAuthoring, resolveProfileArtifactDir, selectBuildProfile } from './delivery-profile.js';
import { packFromDeploymentIr } from './pack.js';
import { assembleDelivery, emitBuildProof } from './build-assemble.js';
import { createCli } from '@vmz/commander';
import { vmzCliLocalize } from './cli-localize.js';

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
    /** @type {Record<string, string | boolean> & { _: string[] }} */
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') {
            out._.push(...argv.slice(i + 1));
            break;
        }
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
        if (a.startsWith('-') && a.length === 2) {
            const key = a === '-o' ? 'out-dir' : a.slice(1);
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

export function printGlobalHelp() {
    console.log(vmzCliLocalize.t('cli.help.global'));
}

export function printProjectHelp() {
    console.log(vmzCliLocalize.t('cli.help.project'));
}

/** @deprecated use printProjectHelp / printGlobalHelp */
export function printHelp() {
    printProjectHelp();
}

/**
 * @param {{ helpId?: string }} [opts]
 */
function buildProductCli(opts = {}) {
    const helpId = opts.helpId || 'cli.help.project';
    const cli = createCli('vmz').use(vmzCliLocalize).help(helpId);

    /** @param {import('@vmz/commander').Command} cmd */
    const withWorkspaceOpts = (cmd) =>
        cmd
            .option('--out-dir, -o <dir>', 'cli.opt.out-dir')
            .option('--release', 'cli.opt.release')
            .option('--profile <name>', 'cli.opt.profile')
            .option('--target <id>', 'cli.opt.target')
            .option('--origin <url>', 'cli.opt.origin')
            .option('--host <host>', 'cli.opt.host')
            .option('--port <port>', 'cli.opt.port')
            .option('--poll-ms <ms>', 'cli.opt.poll-ms')
            .option('--build', 'cli.opt.build')
            .option('--check', 'cli.opt.check')
            .option('--deny-warnings', 'cli.opt.deny-warnings');

    withWorkspaceOpts(cli.command('check', 'cli.cmd.check')).action((options) => cmdCheck(options));
    withWorkspaceOpts(cli.command('build', 'cli.cmd.build')).action((options) => cmdBuild(options));
    withWorkspaceOpts(cli.command('serve', 'cli.cmd.serve')).action((options) => cmdServe(options));
    withWorkspaceOpts(cli.command('dev', 'cli.cmd.dev')).action((options) => cmdDev(options));
    withWorkspaceOpts(cli.command('format', 'cli.cmd.format')).action((options) => cmdFormat(options));
    withWorkspaceOpts(cli.command('lint', 'cli.cmd.lint')).action((options) => cmdLint(options));

    cli.command('test', 'cli.cmd.test')
        .passthrough()
        .action((_o, ...args) => cmdTest(parseArgs(args)));
    cli.command('document|docs', 'cli.cmd.document')
        .passthrough()
        .action((_o, ...args) => cmdDocument(args));
    cli.command('locale|locales', 'cli.cmd.locale')
        .passthrough()
        .action((_o, ...args) => cmdLocale(args));
    cli.command('application|applications|app', 'cli.cmd.application')
        .passthrough()
        .action((_o, ...args) => cmdApplication(args));
    cli.command('artifact|artifacts|release', 'cli.cmd.artifact')
        .passthrough()
        .action((_o, ...args) => cmdArtifact(args));
    cli.command('refactor', 'cli.cmd.refactor')
        .passthrough()
        .action((_o, ...args) => cmdRefactor(args));
    cli.command('explain', 'cli.cmd.explain')
        .passthrough()
        .action((_o, ...args) => cmdExplain(args));

    const plan = cli.command('plan', 'cli.cmd.plan');
    plan.command('locale', 'cli.cmd.plan.locale')
        .option('--json [file]', 'cli.opt.json')
        .action((options) => cmdPlan(planRest('locale', options)));
    plan.command('document-route|document_route', 'cli.cmd.plan.document-route')
        .option('--json [file]', 'cli.opt.json')
        .action((options) => cmdPlan(planRest('document-route', options)));

    cli.command('version', 'cli.cmd.version').action(() => cmdVersion());
    return cli;
}

/**
 * @param {string} kind
 * @param {import('@vmz/commander').ParsedOptions} options
 */
function planRest(kind, options) {
    /** @type {string[]} */
    const out = [kind];
    if (options._?.length) out.push(...options._);
    if (options.json === true) out.push('--json');
    else if (typeof options.json === 'string') out.push('--json', options.json);
    return out;
}

/**
 * @param {string[]} argv
 * @param {{
 * cwd?: string,
 * thisPackageRoot?: string,
 * reexec?: (bin: string, argv: string[]) => Promise<number>,
 * }} [opts]
 * @returns {Promise<number>}
 */
export async function runCli(argv, opts = {}) {
    const [cmd] = argv;
    const inv = getInvocationContext({
        cwd: opts.cwd,
        thisPackageRoot: opts.thisPackageRoot,
    });

    const helpId = inv.mode === 'global' ? 'cli.help.global' : 'cli.help.project';

    if (cmd && !isHelpToken(cmd) && cmd !== 'version' && cmd !== '-V' && cmd !== '--version' && !isGlobalAllowedCommand(cmd)) {
        const gated = await gateGlobalProjectCommand({
            argv,
            cwd: opts.cwd,
            thisPackageRoot: opts.thisPackageRoot,
            reexec: opts.reexec,
            logError: (msg) => log.error(msg),
        });
        if (gated.action === 'exit') return gated.code;
    }

    // Normalize version aliases onto the registered `version` command.
    const normalized =
        cmd === '-V' || cmd === '--version' ? ['version', ...argv.slice(1)] : argv;

    return buildProductCli({ helpId }).parse(normalized);
}

function isHelpToken(token) {
    return token === 'help' || token === '-h' || token === '--help';
}

function cmdVersion() {
    const native = getProtocolVersions();
    console.log(`vmz host ${HOST_PROTOCOL}`);
    console.log(
        `native host=${native.hostProtocol} compiler=${native.compilerProtocol} program_ir=${native.programIrSchema} plugin=${native.pluginProtocol}`,
    );
    return 0;
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 */
function cmdCheck(args) {
    const pathArg = args._[0] ?? '.';
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const meta = readPackageMeta(project);
    log.info(`check ${project}${meta?.name ? ` (${meta.name})` : ''}`);
    const ws = createWorkspace({ root: project, outDir });
    try {
        return runWithPlugins(ws, project, outDir, async () => {
            const report = ws.check();
            const { checkLocales, localeHasErrors } = await import('./locale-check.js');
            const localeReport = checkLocales({ projectRoot: project, checkUnused: false });
            // Locale policy is first-class: missing /locales is warning (not silent), hard errors still fail.
            const errors =
                log.diagnostics([...(report.diagnostics ?? []), ...(localeReport.diagnostics ?? [])]) ||
                (localeHasErrors(localeReport) ? 1 : 0);
            log.info(`checked ${report.filesChecked} file(s)`);
            return errors ? 1 : 0;
        });
    } finally {
        ws.dispose();
    }
}

/**
 * Dedupe locale/build diagnostics by code+path+message (runtime + route emit both report missing manifest).
 * @param {Array<{ code?: string, path?: string, message?: string, severity?: string }>} list
 */
function dedupeDiagnostics(list) {
    const seen = new Set();
    /** @type {typeof list} */
    const out = [];
    for (const d of list || []) {
        const key = `${d.code || ''}\0${d.path || ''}\0${d.message || ''}\0${d.severity || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
    }
    return out;
}

/**
 * @param {import('./index.js').Workspace} ws
 * @param {string} project
 * @param {string} outDir
 * @param {() => Promise<number> | number} fn
 */
async function runWithPlugins(ws, project, outDir, fn) {
    const { loadVmzConfig, applyPlugins } = await import('./plugin-host.js');
    const { plugins, engines } = await loadVmzConfig(project);
    if (plugins.length) {
        await applyPlugins(ws, plugins, { project, outDir, engines });
    }
    return await fn();
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 */
async function cmdBuild(args) {
    const pathArg = args._[0] ?? '.';
    const targetRaw = typeof args.target === 'string' ? args.target : 'browser';
    if (targetRaw !== 'browser' && targetRaw !== 'mini-program-wechat') {
        log.errorId('cli.err.unknown_target', { target: String(targetRaw) });
        return 1;
    }
    const wechatPack = targetRaw === 'mini-program-wechat';
    const { project, outDir: outDirRoot } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const cfg = await loadVmzConfig(project);
    const cliProfile = typeof args.profile === 'string' ? args.profile : '';
    const norm = normalizeDeliveryAuthoring(cfg.delivery ?? null);
    if (!norm.ok) {
        log.diagnostics(norm.diagnostics ?? []);
        log.error('delivery authoring invalid');
        return 1;
    }
    const selected = selectBuildProfile(norm.table, cliProfile);
    if (!selected.ok) {
        log.diagnostics(selected.diagnostics ?? []);
        log.error(`unknown build --profile ${cliProfile || norm.table.default}`);
        return 1;
    }
    const outDir = resolveProfileArtifactDir(outDirRoot, selected.profile);
    log.info(
        `build ${project} → ${outDir}${wechatPack ? ' (target=mini-program-wechat)' : ''} (out-dir=${outDirRoot}, name=${selected.profile.name})`,
    );
    const ws = createWorkspace({ root: project, outDir });
    try {
        log.info(`delivery profile ${selected.selection.profileId} (assembly=${selected.selection.assembly}, name=${selected.profile.name})`);

        const code = await runWithPlugins(ws, project, outDir, () => {
            const report = ws.build(Boolean(args.release));
            const errors = log.diagnostics(report.diagnostics ?? []);
            if (errors) return 1;
            for (const p of report.emitted ?? []) {
                console.log(`emitted ${p}`);
            }
            log.info(`build ok (${(report.emitted ?? []).length} file(s))`);
            return 0;
        });
        if (code !== 0) return code;
        const localeEmit = emitLocaleRuntimeModules(project, outDir);
        const localeRoutes = emitLocaleRouteRealization(project, outDir, {
            origin: typeof args.origin === 'string' ? args.origin : undefined,
        });
        // Always surface locale diagnostics (warnings included) — missing /locales must not be silent.
        // Dedupe: runtime emit + route realization both report the same missing-manifest warning.
        const localeDiags = dedupeDiagnostics([...(localeEmit.diagnostics ?? []), ...(localeRoutes.diagnostics ?? [])]);
        log.diagnostics(localeDiags);
        if (!localeEmit.ok || localeHasErrors({ diagnostics: localeEmit.diagnostics })) {
            log.error('locale runtime emit failed');
            return 1;
        }
        if (localeEmit.written.length) {
            log.info(`locale runtime emit (${localeEmit.written.length} module(s))`);
        }
        if (!localeRoutes.ok) {
            log.error('locale route realization emit failed');
            return 1;
        }
        if (localeRoutes.written.length) {
            log.info(`locale route realization (${localeRoutes.written.length} artifact(s))`);
        }
        if (projectHasDocuments(project)) {
            const docs = await buildIntegratedDocuments({ projectRoot: project, outDir });
            if (!docs.ok) return 1;
        }

        if (wechatPack) {
            if (typeof ws.lowerMiniprogramWechatPackaging !== 'function') {
                log.error('wechat pack: workspace missing lowerMiniprogramWechatPackaging');
                return 1;
            }
            let report;
            try {
                const raw = ws.lowerMiniprogramWechatPackaging();
                report = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (err) {
                log.error(`wechat pack failed: ${err instanceof Error ? err.message : String(err)}`);
                return 1;
            }
            log.diagnostics(report.diagnostics ?? []);
            if (report.status !== 'ready') {
                log.error(`wechat pack ${report.status || 'failed'}`);
                return 1;
            }
            const packRoot = report.packRoot || 'dist/wechat';
            log.info(`wechat pack ok → ${path.join(project, packRoot)} (open in WeChat DevTools)`);
            return 0;
        }

        let pack = null;
        try {
            pack = packFromDeploymentIr(outDir, {
                release: Boolean(args.release),
                profileId: selected.selection.profileId,
                assembly: selected.selection.assembly,
                coreDist: resolveCoreRuntimeDist(),
                projectRoot: project,
            });
            const lower = pack.manifest?.clientPackageLowering;
            if (lower?.bareSpecs?.length) {
                log.info(`pack client packages (${lower.bareSpecs.length} bare → vendor; rewritten=${lower.rewrittenFiles})`);
            }
            if (lower?.remainingBareSpecs?.length) {
                log.warn(
                    `pack client packages: ${lower.remainingBareSpecs.length} bare specifier(s) still unresolved for browser: ${lower.remainingBareSpecs.slice(0, 8).join(', ')}${lower.remainingBareSpecs.length > 8 ? '…' : ''}`,
                );
            }
            log.info(`pack ok (units=${pack.manifest.unitCount}, digest=${String(pack.manifest.packDigest).slice(0, 12)}…)`);
        } catch (err) {
            log.error(`pack failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }

        const origin = typeof args.origin === 'string' ? args.origin : undefined;
        let assemble = null;
        try {
            if (selected.selection.assembly === 'web-static') {
                log.info(`static emit ${outDir}`);
            }
            assemble = await assembleDelivery(outDir, {
                selection: selected.selection,
                profile: {
                    ...selected.profile,
                    sources: selected.profile.sources || (norm.table.sugar ? norm.table.profiles[norm.table.default]?.sources : null),
                },
                siteId: cfg.application?.id || undefined,
                origin,
                pack: pack.manifest,
                projectRoot: project,
            });
            for (const step of assemble.manifest.steps || []) {
                if (step.kind === 'web-static') {
                    log.info(`static ok (${step.htmlFiles} html, ${step.skipped} skipped, digest=${String(step.digest).slice(0, 12)}…)`);
                } else if (step.kind === 'site-delivery' && step.digest) {
                    log.info(`site-delivery ok (digest=${String(step.digest).slice(0, 12)}…)`);
                }
            }
        } catch (err) {
            log.error(`assemble failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }

        const proof = emitBuildProof(outDir, {
            selection: selected.selection,
            pack: pack.manifest,
            assemble: assemble.manifest,
            release: Boolean(args.release),
        });
        log.info(`build-proof ok (profile=${proof.proof.profileId}, slots=${proof.proof.semanticIds.join(',')})`);
        return 0;
    } finally {
        ws.dispose();
    }
}

async function cmdServe(args) {
    const pathArg = args._[0] ?? '.';
    if (args.build) {
        const code = await cmdBuild(args);
        if (code !== 0) return code;
    }
    const { project, outDir: outDirRoot } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const cfg = await loadVmzConfig(project);
    const cliProfile = typeof args.profile === 'string' ? args.profile : '';
    const norm = normalizeDeliveryAuthoring(cfg.delivery ?? null);
    if (!norm.ok) {
        log.diagnostics(norm.diagnostics ?? []);
        log.error('delivery authoring invalid');
        return 1;
    }
    const selected = selectBuildProfile(norm.table, cliProfile);
    if (!selected.ok) {
        log.diagnostics(selected.diagnostics ?? []);
        log.error(`unknown build --profile ${cliProfile || norm.table.default}`);
        return 1;
    }
    const outDir = resolveProfileArtifactDir(outDirRoot, selected.profile);
    const hostJs = path.join(outDir, 'vmz-serve-host.mjs');
    if (!existsSync(hostJs)) {
        try {
            materializeServeHostRuntime(outDir);
            log.info(`materialized ${hostJs} from @vmz/core (release builds omit it)`);
        } catch (err) {
            log.error(
                `missing ${hostJs} — run \`vmz build\` (without --release) or ensure @vmz/core is installed (${err instanceof Error ? err.message : err})`,
            );
            return 1;
        }
    }
    const host = typeof args.host === 'string' ? args.host : '127.0.0.1';
    const port = Number(args.port ?? 5173);
    log.info(`serve http://${host}:${port}`);
    const node = process.env.VMZ_NODE || process.execPath;
    const child = spawn(node, [hostJs], {
        cwd: project,
        env: {
            ...process.env,
            VMZ_DIST: outDir,
            VMZ_PORT: String(port),
            VMZ_HOST: host,
            VMZ_PROJECT_ROOT: project,
            VMZ_NATIVE_NODE: resolveNativePath(),
        },
        stdio: 'inherit',
    });

    return await new Promise((resolve) => {
        const shutdown = () => {
            child.kill();
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        child.on('exit', (code, signal) => {
            process.off('SIGINT', shutdown);
            process.off('SIGTERM', shutdown);
            if (signal) resolve(0);
            else resolve(code ?? 1);
        });
    });
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 */
async function cmdDev(args) {
    const pathArg = args._[0] ?? '.';
    const { project, outDir: outDirRoot } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const cfg = await loadVmzConfig(project);
    const cliProfile = typeof args.profile === 'string' ? args.profile : '';
    const norm = normalizeDeliveryAuthoring(cfg.delivery ?? null);
    if (!norm.ok) {
        log.diagnostics(norm.diagnostics ?? []);
        log.error('delivery authoring invalid');
        return 1;
    }
    const selected = selectBuildProfile(norm.table, cliProfile);
    if (!selected.ok) {
        log.diagnostics(selected.diagnostics ?? []);
        log.error(`unknown build --profile ${cliProfile || norm.table.default}`);
        return 1;
    }
    const outDir = resolveProfileArtifactDir(outDirRoot, selected.profile);
    const host = typeof args.host === 'string' ? args.host : '127.0.0.1';
    const portLocked = Object.prototype.hasOwnProperty.call(args, 'port');
    let port;
    if (portLocked) {
        port = Number(args.port);
        if (!Number.isFinite(port) || port <= 0) {
            log.error(`invalid --port ${String(args.port)}`);
            return 1;
        }
    } else {
        const preferred = 5173;
        port = await findAvailablePort(host, preferred);
        if (port !== preferred) {
            log.info(`port ${preferred} busy → using ${port}`);
        }
    }
    const pollMs = Number(args['poll-ms'] ?? 300);
    const targetRaw = typeof args.target === 'string' ? args.target : 'browser';
    if (targetRaw !== 'browser' && targetRaw !== 'mini-program-wechat') {
        log.errorId('cli.err.unknown_target', { target: String(targetRaw) });
        return 1;
    }

    const ac = new AbortController();
    const onSig = () => {
        log.info('shutting down…');
        ac.abort();
    };
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);

    const session = createDevSession({
        project,
        outDir,
        host,
        port,
        pollMs,
        target: targetRaw,
        signal: ac.signal,
    });

    try {
        await session.start();
        return 0;
    } catch (err) {
        if (ac.signal.aborted) return 0;
        log.error(String(err));
        return 1;
    } finally {
        process.off('SIGINT', onSig);
        process.off('SIGTERM', onSig);
        await session.stop();
    }
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 */
function cmdFormat(args) {
    const pathArg = args._[0] ?? '.';
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const checkOnly = Boolean(args.check);
    log.info(`format ${project}${checkOnly ? ' --check' : ''}`);
    const ws = createWorkspace({ root: project, outDir });
    try {
        const report = ws.format(checkOnly);
        const errors = log.diagnostics(report.diagnostics ?? []);
        if (checkOnly) {
            log.info(`checked ${report.filesChecked} file(s); ${report.filesNeedWrite} need write`);
            return errors || report.filesNeedWrite > 0 ? 1 : 0;
        }
        log.info(`formatted ${report.filesWritten}/${report.filesChecked} file(s)`);
        return errors ? 1 : 0;
    } finally {
        ws.dispose();
    }
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args
 */
function cmdLint(args) {
    const pathArg = args._[0] ?? '.';
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const denyWarnings = Boolean(args['deny-warnings']);
    log.info(`lint ${project}`);
    const ws = createWorkspace({ root: project, outDir });
    try {
        const report = ws.lint(denyWarnings);
        const errors = log.diagnostics(report.diagnostics ?? [], { denyWarnings });
        log.info(`linted ${report.filesChecked} file(s)`);
        return errors ? 1 : 0;
    } finally {
        ws.dispose();
    }
}

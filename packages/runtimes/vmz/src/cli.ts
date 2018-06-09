// @ts-nocheck
/**
 * Node CLI command implementations .
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HOST_PROTOCOL, createWorkspace, getProtocolVersions, resolveCoreRuntimeDist } from './index.js';
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
import { resolveNativeVmzCli } from './resolve-native-cli.js';
import { loadVmzConfig } from './plugin-host.js';
import { normalizeDeliveryAuthoring, selectBuildProfile } from './delivery-profile.js';
import { packFromDeploymentIr } from './pack.js';
import { assembleDelivery, emitBuildProof } from './build-assemble.js';

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
    console.log(`vmz — global mode (scaffold only)

Install faces: @vmz/core (runtime) · @vmz/vmz (this CLI) · optional @vmz/ui / @vmz/plugin-*

Three install modes:
  developer  monorepo source (packages/runtimes/vmz) — full CLI
  project    app node_modules/@vmz/vmz — full CLI
  global     npm/pnpm -g — only new/init/help/version

You are in global mode. Pin \`@vmz/vmz\` in the app so check/build/lsp
use a traceable project install.

Usage:
  vmz new|init <dir>            Scaffold (native CLI; Node only gates + forwards)
  vmz version                   Show host + native protocol versions
  vmz help                      Show this help

Project commands:
  pnpm add @vmz/core && pnpm add -D @vmz/vmz
  pnpm exec vmz check
  # or: vmz new my-app && cd my-app && pnpm install

If a project \`node_modules/@vmz/vmz\` exists, a global
\`vmz <cmd>\` re-execs that bin.
`);
}

export function printProjectHelp() {
    console.log(`vmz — Node toolchain host (project / developer mode)

Usage:
  vmz new|init <dir>            Scaffold a minimal app (native CLI)
  vmz check [path]              Check project via Workspace
  vmz build [path] [options]    Build project via Workspace
  vmz serve [path] [options]    Serve dist (optional --build)
  vmz dev [path] [options]      Long-lived rebuild session (no CLI spawn)
  vmz format [path] [--check]   Format .vmz via N-API (oxc codegen)
  vmz lint [path] [--deny-warnings]  Lint (= check) via N-API
  vmz test [path] [options]     Native test discover / report
  vmz document|docs <cmd>       Project /documents domain 
  vmz application <cmd>         Application Collection / Mount 
  vmz artifact <cmd>            Release pack / publish / rollback / diff (A3)
  vmz refactor <cmd>            DX rename plans / apply 
  vmz explain [style] <target>  DX causal explain (style Theme chain)
  vmz lsp [root] [--out-dir]    Language server (stdio; native CLI)
  vmz mcp [root] [--out-dir]    MCP server (stdio; native CLI)
  vmz version                   Show host + native protocol versions
  vmz help                      Show this help

Options:
  --out-dir, -o <dir>   Output directory (default: dist)
  --release             Release build (omit serve-host; pack minify slot; proof)
  --profile <name>      Delivery profile (default from config; builtins: web-ssr|web-static|web-client|web-hybrid)
  --origin <url>        Site origin for static-cdn canonical/sitemap
  --host <host>         Listen host (default: 127.0.0.1)
  --port <port>         Listen port (dev: omit = auto from 5173; set = lock)
  --poll-ms <ms>        Dev watch poll interval (default: 300)
  --build               Build before serve
  --check               Format check-only (format)
  --deny-warnings       Treat warnings as errors (lint)
  --list                List discovered tests (test)
  --json [file]         Emit TestReport / DocumentManifest / ApplicationCheckReport JSON
  --mode <modes>        compile|logic|browser|ssr|resume|deployment|all (test)
  --filter <pattern>    Filter by test id or file (test)
  --application <id>    Run only tests for ApplicationId (standalone scope)
  --mounted <id>        Run relocation + host-boundary tests for ApplicationId
  --affected            Select tests from dirty VPG units (test; DX)
  --root <dir>          Project root (document check)
  --strict              Strict document locale/PageKey coverage (document check)
`);
}

/** @deprecated use printProjectHelp / printGlobalHelp */
export function printHelp() {
    printProjectHelp();
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
    const [cmd, ...rest] = argv;
    const inv = getInvocationContext({
        cwd: opts.cwd,
        thisPackageRoot: opts.thisPackageRoot,
    });

    if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
        if (inv.mode === 'global') printGlobalHelp();
        else printProjectHelp();
        return 0;
    }
    if (cmd === 'version' || cmd === '-V' || cmd === '--version') {
        return cmdVersion();
    }

    if (!isGlobalAllowedCommand(cmd)) {
        const gated = await gateGlobalProjectCommand({
            argv,
            cwd: opts.cwd,
            thisPackageRoot: opts.thisPackageRoot,
            reexec: opts.reexec,
            logError: (msg) => log.error(msg),
        });
        if (gated.action === 'exit') return gated.code;
    }

    const args = parseArgs(rest);
    switch (cmd) {
        case 'new':
        case 'init':
            return cmdNativeForward(cmd, rest);
        case 'check':
            return cmdCheck(args);
        case 'build':
            return cmdBuild(args);
        case 'serve':
            return cmdServe(args);
        case 'dev':
            return cmdDev(args);
        case 'format':
            return cmdFormat(args);
        case 'lint':
            return cmdLint(args);
        case 'test':
            return cmdTest(args);
        case 'document':
        case 'docs':
            return cmdDocument(rest);
        case 'locale':
        case 'locales':
            return cmdLocale(rest);
        case 'application':
        case 'applications':
        case 'app':
            return cmdApplication(rest);
        case 'artifact':
        case 'artifacts':
        case 'release':
            return cmdArtifact(rest);
        case 'refactor':
            return cmdRefactor(rest);
        case 'explain':
            return cmdExplain(rest);
        case 'lsp':
            return cmdNativeForward('lsp', rest);
        case 'mcp':
            return cmdNativeForward('mcp', rest);
        default:
            log.error(`unknown command \`${cmd}\``);
            if (inv.mode === 'global') printGlobalHelp();
            else printProjectHelp();
            return 1;
    }
}

/**
 * Forward to the single native `vmz` binary (vmz-tools).
 * Scaffold / stdio servers live in Rust — Node only gates + re-execs.
 *
 * @param {'new' | 'init' | 'lsp' | 'mcp'} sub
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
function cmdNativeForward(sub, argv) {
    const bin = resolveNativeVmzCli();
    if (!bin) {
        log.error('native `vmz` CLI not found (vmz-tools).');
        log.error('Build: cargo build -p vmz-tools');
        log.error('Or set VMZ_NATIVE to the absolute path of that binary.');
        return Promise.resolve(1);
    }
    return new Promise((resolve) => {
        const child = spawn(bin, [sub, ...argv], { stdio: 'inherit' });
        child.on('error', (err) => {
            log.error(`failed to spawn ${bin}: ${err.message}`);
            resolve(1);
        });
        child.on('exit', (code, signal) => {
            if (signal) resolve(1);
            else resolve(code ?? 1);
        });
    });
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
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    log.info(`build ${project} → ${outDir}`);
    const ws = createWorkspace({ root: project, outDir });
    try {
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
        log.info(`delivery profile ${selected.selection.profileId} (assembly=${selected.selection.assembly})`);

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
            if (selected.selection.assembly === 'static-cdn') {
                log.info(`web-static emit ${outDir}`);
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
            });
            for (const step of assemble.manifest.steps || []) {
                if (step.kind === 'static-cdn') {
                    log.info(`web-static ok (${step.htmlFiles} html, ${step.skipped} skipped, digest=${String(step.digest).slice(0, 12)}…)`);
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
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
    const hostJs = path.join(outDir, 'vmz-serve-host.mjs');
    if (!existsSync(hostJs)) {
        const coreDist = resolveCoreRuntimeDist();
        const src = coreDist ? path.join(coreDist, 'serve-host.mjs') : null;
        if (src && existsSync(src)) {
            copyFileSync(src, hostJs);
            log.info(`materialized ${hostJs} from @vmz/core (release builds omit it)`);
        } else {
            log.error(`missing ${hostJs} — run \`vmz build\` (without --release) or ensure @vmz/core is installed`);
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
    const { project, outDir } = resolveWorkspaceDirs({
        path: pathArg,
        outDir: typeof args['out-dir'] === 'string' ? args['out-dir'] : undefined,
    });
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

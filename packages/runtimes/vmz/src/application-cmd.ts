// @ts-nocheck
/**
 * `vmz application` — Application Collection / Mount .
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadNative } from './index.js';
import { log } from './log.js';
import { resolveWorkspacePackages } from './packages.js';
import { resolveWorkspaceDirs } from './resolve.js';

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function cmdApplication(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
        printHelp();
        return 0;
    }
    if (sub === 'check') return cmdCheck(rest);
    if (sub === 'list') return cmdList(rest);
    if (sub === 'schemas' || sub === 'protocol') return cmdSchemas();
    if (sub === 'relocatable') return cmdRelocatable(rest);
    if (sub === 'relocate') return cmdRelocate(rest);
    if (sub === 'artifacts') return cmdArtifacts(rest);
    if (sub === 'isolation') return cmdIsolation(rest);
    if (sub === 'composition' || sub === 'compose' || sub === 'host') return cmdComposition(rest);
    if (sub === 'dev' || sub === 'sessions' || sub === 'm5') return cmdDev(rest);
    log.error(`unknown application subcommand \`${sub}\``);
    printHelp();
    return 1;
}

function printHelp() {
    console.log(`vmz application — Application Collection / Mount

Usage:
  vmz application check [host]              Validate descriptors + applications.config.json5
  vmz application list [host]               List resolved ApplicationIds / collections / mounts
  vmz application schemas                   Print frozen protocol catalog JSON
  vmz application relocatable [pkg]          ApplicationBase / non_relocatable_url proof
  vmz application relocate <manifest.json>  apply ApplicationBase to relocation manifest
  vmz application artifacts [host]          ApplicationArtifact + MountTable boundary
  vmz application isolation [host]          isolation namespaces + failure containment
  vmz application composition [host]        catalog consumption + cross-app Link hrefs
  vmz application dev [host]                sessions / affected / proxy / mounted tests / deploy

Options:
  --json [file]    Emit report JSON to stdout or file
  --base <path>    ApplicationBase for relocatable / relocate (e.g. /examples/counter)
  --dirty <path>   Dirty file path for affected planning (repeatable)
`);
}

/**
 * @param {string[]} argv
 */
function parseRest(argv) {
    /** @type {Record<string, string | boolean | string[]> & { _: string[] }} */
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (key === 'json') {
                if (next && !next.startsWith('-')) {
                    out.json = next;
                    i += 1;
                } else {
                    out.json = true;
                }
                continue;
            }
            if (key === 'dirty') {
                if (!Array.isArray(out.dirty)) out.dirty = [];
                if (next && !next.startsWith('-')) {
                    out.dirty.push(next);
                    i += 1;
                }
                continue;
            }
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
 * @param {{ json?: string | boolean }} args
 * @param {string} json
 * @param {(data: any) => void} [printHuman]
 */
function emitJson(args, json, printHuman) {
    if (typeof args.json === 'string') {
        writeFileSync(args.json, `${json}\n`, 'utf8');
        return;
    }
    if (args.json === true) {
        console.log(json);
        return;
    }
    if (printHuman) printHuman(JSON.parse(json));
    else console.log(json);
}

function cmdSchemas() {
    const native = loadNative();
    console.log(native.queryApplicationProtocolCatalog);
    return 0;
}

/**
 * @param {string[]} argv
 */
function cmdCheck(argv) {
    const args = parseRest(argv);
    const report = runCheck(args._[0] ?? '.');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d) => d.severity === 'error');
        log.info(
            `application check: descriptors=${data.descriptors.length} collections=${data.collections.length} mounts=${data.mounts.length} errors=${errors.length}`,
        );
        for (const d of data.diagnostics) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return report.data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdList(argv) {
    const args = parseRest(argv);
    const report = runCheck(args._[0] ?? '.');
    emitJson(args, report.json, (data) => {
        for (const d of data.descriptors) {
            console.log(`application ${d.id}\t${d.entryRoute}\t${d.packageRoot ?? ''}`);
        }
        for (const m of data.mounts) {
            console.log(`mount ${m.application}\t${m.routeBase}`);
        }
        for (const c of data.collections) {
            const apps = c.groups.flatMap((g) => g.applications).join(',');
            console.log(`collection ${c.id}\t${apps}`);
        }
    });
    return report.data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdRelocatable(argv) {
    const args = parseRest(argv);
    const { project } = resolveWorkspaceDirs({ path: args._[0] ?? '.' });
    const native = loadNative();
    if (typeof native.checkApplicationRelocatableJson !== 'function') {
        throw new Error('checkApplicationRelocatableJson missing — rebuild native (pnpm napi:build)');
    }
    const base = typeof args.base === 'string' ? args.base : null;
    const json = native.checkApplicationRelocatableJson(project, base);
    const data = JSON.parse(json);
    emitJson(args, json, () => {
        const errors = data.diagnostics.filter((d) => d.severity === 'error');
        log.info(`application relocatable: entries=${data.manifest?.entries?.length ?? 0} errors=${errors.length}`);
        for (const d of data.diagnostics) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdRelocate(argv) {
    const args = parseRest(argv);
    const manifestPath = args._[0];
    if (!manifestPath) {
        log.error('relocate requires a relocation manifest JSON path');
        return 1;
    }
    if (typeof args.base !== 'string' || !args.base) {
        log.error('relocate requires --base <ApplicationBase>');
        return 1;
    }
    const native = loadNative();
    if (typeof native.relocateApplicationManifestJson !== 'function') {
        throw new Error('relocateApplicationManifestJson missing — rebuild native (pnpm napi:build)');
    }
    const manifestJson = readFileSync(path.resolve(manifestPath), 'utf8');
    const json = native.relocateApplicationManifestJson(manifestJson, args.base);
    emitJson(args, json);
    return 0;
}

/**
 * @param {string[]} argv
 */
function cmdArtifacts(argv) {
    const args = parseRest(argv);
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationArtifactBoundaryJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d) => d.severity === 'error');
        log.info(
            `application artifacts: artifacts=${data.artifacts?.length ?? 0} mounts=${data.mountTable?.mounts?.length ?? 0} errors=${errors.length}`,
        );
        for (const d of data.diagnostics) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return report.data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdIsolation(argv) {
    const args = parseRest(argv);
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationIsolationJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d) => d.severity === 'error');
        log.info(
            `application isolation: namespaces=${data.namespaces?.length ?? 0} containment=${data.failureContainment?.length ?? 0} errors=${errors.length}`,
        );
        for (const d of data.diagnostics) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return report.data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdComposition(argv) {
    const args = parseRest(argv);
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationHostCompositionJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d) => d.severity === 'error');
        log.info(
            `application composition: catalog=${data.catalog?.applications?.length ?? 0} links=${data.crossApplicationLinks?.length ?? 0} errors=${errors.length}`,
        );
        for (const link of data.crossApplicationLinks ?? []) {
            console.log(
                `link ${link.applicationId}\t${link.routeId}\t${link.href ?? '(unresolved)'}\tdocumentNavigation=${link.documentNavigation}`,
            );
        }
        for (const d of data.diagnostics) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return report.data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string[]} argv
 */
function cmdDev(argv) {
    const args = parseRest(argv);
    const pathArg = args._[0] ?? '.';
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    if (!roots.includes(project)) roots.unshift(project);
    const dirty = Array.isArray(args.dirty) ? args.dirty.map((d) => path.resolve(project, String(d))) : [];
    const native = loadNative();
    if (typeof native.checkApplicationDevTestDeployJson !== 'function') {
        log.error('checkApplicationDevTestDeployJson missing — rebuild native (`pnpm napi:build`)');
        return 1;
    }
    const json = native.checkApplicationDevTestDeployJson(project, roots, dirty);
    let data;
    try {
        data = JSON.parse(json);
    } catch (e) {
        log.error(`dev report not JSON: ${e}`);
        return 1;
    }
    emitJson(args, json, (report) => {
        const errors = (report.diagnostics || []).filter((d) => d.severity === 'error');
        log.info(
            `application dev: sessions=${report.sessions?.sessions?.length ?? 0} affected=${report.affected?.units?.length ?? 0} proxy=${report.proxy?.cases?.length ?? 0} errors=${errors.length}`,
        );
        for (const u of report.affected?.units ?? []) {
            console.log(`affected ${u.applicationId}\t${u.reason}`);
        }
        for (const c of report.proxy?.cases ?? []) {
            console.log(`proxy ${c.url}\t${c.applicationId ?? '-'}\t${c.status}\t${c.reason ?? ''}`);
        }
        for (const d of report.diagnostics || []) {
            const fn = d.severity === 'error' ? log.error : log.warn;
            fn(`${d.code}: ${d.path}: ${d.message}`);
        }
    });
    return data.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
}

/**
 * @param {string} pathArg
 * @param {string} nativeFn
 */
function runHostPackageReport(pathArg, nativeFn) {
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    if (!roots.includes(project)) roots.unshift(project);

    const native = loadNative();
    if (typeof native[nativeFn] !== 'function') {
        throw new Error(`${nativeFn} missing — rebuild native (pnpm napi:build)`);
    }
    const json = native[nativeFn](project, roots);
    const data = JSON.parse(json);
    return { project, json, data };
}

/**
 * @param {string} pathArg
 */
export function runCheck(pathArg) {
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    // Always include host root so a local package.json#vmz.application is visible.
    if (!roots.includes(project)) roots.unshift(project);

    const native = loadNative();
    if (typeof native.checkApplicationsJson !== 'function') {
        throw new Error('checkApplicationsJson missing — rebuild native (pnpm napi:build)');
    }
    const json = native.checkApplicationsJson(project, roots);
    const data = JSON.parse(json);
    return { project, json, data };
}

/**
 * @param {string} hostRoot
 * @returns {boolean}
 */
export function hasApplicationsConfig(hostRoot) {
    return existsSync(path.join(hostRoot, 'applications.config.json5'));
}

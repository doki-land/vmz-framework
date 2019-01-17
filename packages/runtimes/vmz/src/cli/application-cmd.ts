/**
 * `vmz application` — registered on `@vmz/commander`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { loadNative } from '../workspace/public-api.js';
import { log } from '../workspace/log.js';
import { resolveWorkspacePackages } from '../workspace/packages.js';
import { resolveWorkspaceDirs } from '../workspace/resolve.js';

export function registerApplicationCommands(parent: Command): void {
    const withCommon = (cmd: Command) =>
        cmd.option('--json [file]', 'cli.opt.json').option('--base <path>', 'cli.opt.base').option('--dirty <path>...', 'cli.opt.dirty');

    withCommon(parent.command('check', 'cli.cmd.application.check')).action((o) => cmdCheck(o));
    withCommon(parent.command('list', 'cli.cmd.application.list')).action((o) => cmdList(o));
    parent.command('schemas|protocol', 'cli.cmd.application.schemas').action(() => cmdSchemas());
    withCommon(parent.command('relocatable', 'cli.cmd.application.relocatable')).action((o) => cmdRelocatable(o));
    withCommon(parent.command('relocate', 'cli.cmd.application.relocate')).action((o) => cmdRelocate(o));
    withCommon(parent.command('artifacts', 'cli.cmd.application.artifacts')).action((o) => cmdArtifacts(o));
    withCommon(parent.command('isolation', 'cli.cmd.application.isolation')).action((o) => cmdIsolation(o));
    withCommon(parent.command('composition|compose|host', 'cli.cmd.application.composition')).action((o) => cmdComposition(o));
    withCommon(parent.command('dev|sessions|m5', 'cli.cmd.application.dev')).action((o) => cmdDev(o));
}

function emitJson(args: ParsedOptions, json: string, printHuman?: (data: any) => void): void {
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

function cmdSchemas(): number {
    const native = loadNative();
    console.log(native.queryApplicationProtocolCatalog);
    return 0;
}

function cmdCheck(args: ParsedOptions): number {
    const report = runCheck(args._[0] ?? '.');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d: any) => d.severity === 'error');
        log.info(
            `application check: descriptors=${data.descriptors.length} collections=${data.collections.length} mounts=${data.mounts.length} errors=${errors.length}`,
        );
        log.diagnostics(data.diagnostics ?? []);
    });
    return report.data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdList(args: ParsedOptions): number {
    const report = runCheck(args._[0] ?? '.');
    emitJson(args, report.json, (data) => {
        for (const d of data.descriptors) {
            console.log(`application ${d.id}\t${d.entryRoute}\t${d.packageRoot ?? ''}`);
        }
        for (const m of data.mounts) {
            console.log(`mount ${m.application}\t${m.routeBase}`);
        }
        for (const c of data.collections) {
            const apps = c.groups.flatMap((g: any) => g.applications).join(',');
            console.log(`collection ${c.id}\t${apps}`);
        }
    });
    return report.data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdRelocatable(args: ParsedOptions): number {
    const { project } = resolveWorkspaceDirs({ path: args._[0] ?? '.' });
    const native = loadNative();
    if (typeof native.checkApplicationRelocatableJson !== 'function') {
        throw new Error('checkApplicationRelocatableJson missing — rebuild native (pnpm napi:build)');
    }
    const base = typeof args.base === 'string' ? args.base : null;
    const json = native.checkApplicationRelocatableJson(project, base);
    const data = JSON.parse(json);
    emitJson(args, json, () => {
        const errors = data.diagnostics.filter((d: any) => d.severity === 'error');
        log.info(`application relocatable: entries=${data.manifest?.entries?.length ?? 0} errors=${errors.length}`);
        log.diagnostics(data.diagnostics ?? []);
    });
    return data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdRelocate(args: ParsedOptions): number {
    const manifestPath = args._[0];
    if (!manifestPath) {
        log.errorId('cli.err.application_relocate_manifest');
        return 1;
    }
    if (typeof args.base !== 'string' || !args.base) {
        log.errorId('cli.err.application_relocate_base');
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

function cmdArtifacts(args: ParsedOptions): number {
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationArtifactBoundaryJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d: any) => d.severity === 'error');
        log.info(
            `application artifacts: artifacts=${data.artifacts?.length ?? 0} mounts=${data.mountTable?.mounts?.length ?? 0} errors=${errors.length}`,
        );
        log.diagnostics(data.diagnostics ?? []);
    });
    return report.data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdIsolation(args: ParsedOptions): number {
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationIsolationJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d: any) => d.severity === 'error');
        log.info(
            `application isolation: namespaces=${data.namespaces?.length ?? 0} containment=${data.failureContainment?.length ?? 0} errors=${errors.length}`,
        );
        log.diagnostics(data.diagnostics ?? []);
    });
    return report.data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdComposition(args: ParsedOptions): number {
    const report = runHostPackageReport(args._[0] ?? '.', 'checkApplicationHostCompositionJson');
    emitJson(args, report.json, (data) => {
        const errors = data.diagnostics.filter((d: any) => d.severity === 'error');
        log.info(
            `application composition: catalog=${data.catalog?.applications?.length ?? 0} links=${data.crossApplicationLinks?.length ?? 0} errors=${errors.length}`,
        );
        for (const link of data.crossApplicationLinks ?? []) {
            console.log(
                `link ${link.applicationId}\t${link.routeId}\t${link.href ?? '(unresolved)'}\tdocumentNavigation=${link.documentNavigation}`,
            );
        }
        log.diagnostics(data.diagnostics ?? []);
    });
    return report.data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function cmdDev(args: ParsedOptions): number {
    const pathArg = args._[0] ?? '.';
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    if (!roots.includes(project)) roots.unshift(project);
    const dirtyRaw = args.dirty;
    const dirty = Array.isArray(dirtyRaw)
        ? dirtyRaw.map((d) => path.resolve(project, String(d)))
        : typeof dirtyRaw === 'string'
          ? [path.resolve(project, dirtyRaw)]
          : [];
    const native = loadNative();
    if (typeof native.checkApplicationDevTestDeployJson !== 'function') {
        log.error('checkApplicationDevTestDeployJson missing — rebuild native (`pnpm napi:build`)');
        return 1;
    }
    const json = native.checkApplicationDevTestDeployJson(project, roots, dirty);
    let data: any;
    try {
        data = JSON.parse(json);
    } catch (e) {
        log.error(`dev report not JSON: ${e}`);
        return 1;
    }
    emitJson(args, json, (report) => {
        const errors = (report.diagnostics || []).filter((d: any) => d.severity === 'error');
        log.info(
            `application dev: sessions=${report.sessions?.sessions?.length ?? 0} affected=${report.affected?.units?.length ?? 0} proxy=${report.proxy?.cases?.length ?? 0} errors=${errors.length}`,
        );
        for (const u of report.affected?.units ?? []) {
            console.log(`affected ${u.applicationId}\t${u.reason}`);
        }
        for (const c of report.proxy?.cases ?? []) {
            console.log(`proxy ${c.url}\t${c.applicationId ?? '-'}\t${c.status}\t${c.reason ?? ''}`);
        }
        log.diagnostics(report.diagnostics || []);
    });
    return data.diagnostics.some((d: any) => d.severity === 'error') ? 1 : 0;
}

function runHostPackageReport(pathArg: string, nativeFn: string): { project: string; json: string; data: any } {
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    if (!roots.includes(project)) roots.unshift(project);

    const native = loadNative() as Record<string, unknown>;
    if (typeof native[nativeFn] !== 'function') {
        throw new Error(`${nativeFn} missing — rebuild native (pnpm napi:build)`);
    }
    const json = (native[nativeFn] as (project: string, roots: string[]) => string)(project, roots);
    const data = JSON.parse(json);
    return { project, json, data };
}

export function runCheck(pathArg: string): { project: string; json: string; data: any } {
    const { project } = resolveWorkspaceDirs({ path: pathArg });
    const packages = resolveWorkspacePackages(project);
    const roots = packages.map((p) => p.root);
    if (!roots.includes(project)) roots.unshift(project);

    const native = loadNative();
    if (typeof native.checkApplicationsJson !== 'function') {
        throw new Error('checkApplicationsJson missing — rebuild native (pnpm napi:build)');
    }
    const json = native.checkApplicationsJson(project, roots);
    const data = JSON.parse(json);
    return { project, json, data };
}

export function hasApplicationsConfig(hostRoot: string): boolean {
    return existsSync(path.join(hostRoot, 'applications.config.json5'));
}

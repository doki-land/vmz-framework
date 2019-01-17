/**
 * `vmz locale` — registered on `@vmz/commander`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { parseAuthorInput } from '../workspace/author-input.js';
import { checkLocales, emitLocaleTypedModules, localeHasErrors, planLocaleRename } from './locale-check.js';
import { checkLocaleDelivery } from './locale-delivery.js';
import { checkLocaleRouter } from './locale-router.js';
import { checkLocaleRuntime } from './locale-runtime.js';
import {
    checkLocaleConformance,
    diffLocaleCatalogs,
    explainLocaleMessage,
    extractHardcodedText,
    pseudoLocalizeCatalog,
} from './locale-tooling.js';
import { log } from '../workspace/log.js';
import { emitPrettyJson, generatePrettyJson } from '../workspace/pretty-json.js';

export function registerLocaleCommands(parent: Command): void {
    const withCommon = (cmd: Command) =>
        cmd
            .option('--root <dir>', 'cli.opt.root')
            .option('--out <dir>', 'cli.opt.out')
            .option('--locale <id>', 'cli.opt.locale')
            .option('--delivery <id>', 'cli.opt.delivery')
            .option('--timezone <tz>', 'cli.opt.timezone')
            .option('--strict', 'cli.opt.strict')
            .option('--check', 'cli.opt.check')
            .option('--production', 'cli.opt.production')
            .option('--json [file]', 'cli.opt.json');

    withCommon(parent.command('check', 'cli.cmd.locale.check')).action((o) => cmdLocaleCheck(o));
    withCommon(parent.command('list', 'cli.cmd.locale.list')).action((o) => cmdLocaleList(o));
    withCommon(parent.command('emit-types', 'cli.cmd.locale.emit-types')).action((o) => cmdLocaleEmitTypes(o));
    withCommon(parent.command('rename', 'cli.cmd.locale.rename')).action((o) => cmdLocaleRename(o));
    withCommon(parent.command('runtime-check', 'cli.cmd.locale.runtime-check')).action((o) => cmdLocaleRuntimeCheck(o));
    withCommon(parent.command('router-check', 'cli.cmd.locale.router-check')).action((o) => cmdLocaleRouterCheck(o));
    withCommon(parent.command('delivery-check', 'cli.cmd.locale.delivery-check')).action((o) => cmdLocaleDeliveryCheck(o));
    withCommon(parent.command('explain', 'cli.cmd.locale.explain')).action((o) => cmdLocaleExplain(o));
    withCommon(parent.command('diff', 'cli.cmd.locale.diff')).action((o) => cmdLocaleDiff(o));
    withCommon(parent.command('extract', 'cli.cmd.locale.extract')).action((o) => cmdLocaleExtract(o));
    withCommon(parent.command('pseudo', 'cli.cmd.locale.pseudo')).action((o) => cmdLocalePseudo(o));
    withCommon(parent.command('conformance', 'cli.cmd.locale.conformance')).action((o) => cmdLocaleConformance(o));
}

function resolveProject(args: ParsedOptions): string {
    const project = (typeof args.root === 'string' && args.root) || (typeof args._[0] === 'string' && args._[0]) || '.';
    return path.resolve(project);
}

function asJsonTarget(value: string | boolean | string[] | undefined): string | boolean | undefined {
    if (Array.isArray(value)) return true;
    return value;
}

function emitJson(args: ParsedOptions, report: unknown): void {
    emitPrettyJson(asJsonTarget(args.json), report, {
        logWrote: (p) => log.info(`wrote ${p}`),
    });
}

function cmdLocaleCheck(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const report = checkLocales({ projectRoot, strict: Boolean(args.strict) });
    const jsonOut = asJsonTarget(args.json);
    if (jsonOut) {
        emitPrettyJson(jsonOut, report, { logWrote: (p) => log.info(`wrote ${p}`) });
    } else {
        log.diagnostics(report.diagnostics ?? []);
        const n = report.messageCatalog?.messages?.length || 0;
        log.info(
            `locale check: locales=${(report.manifest?.locales || []).map((l) => l.id).join(',') || '(none)'} messages=${n} status=${report.status}`,
        );
    }
    return localeHasErrors(report) ? 1 : 0;
}

function cmdLocaleList(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const report = checkLocales({ projectRoot, checkUnused: false });
    if (!report.manifest) {
        log.diagnostics(report.diagnostics ?? []);
        return localeHasErrors(report) ? 1 : 0;
    }
    for (const loc of report.manifest.locales) {
        const mark = loc.id === report.manifest.defaultLocale ? ' (default)' : '';
        console.log(`${loc.id}\t${loc.label || ''}${mark}`);
    }
    return localeHasErrors(report) ? 1 : 0;
}

function cmdLocaleEmitTypes(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'locales-types');
    const report = checkLocales({ projectRoot, strict: Boolean(args.strict) });
    if (localeHasErrors(report)) {
        log.diagnostics((report.diagnostics || []).filter((x) => x.severity === 'error'));
        return 1;
    }
    const written = emitLocaleTypedModules(report, outDir);
    log.info(`locale emit-types: modules=${written.length} out=${path.relative(process.cwd(), outDir) || '.'}`);
    return 0;
}

function cmdLocaleRename(args: ParsedOptions): number {
    const fromId = typeof args._[0] === 'string' ? args._[0] : '';
    const toId = typeof args._[1] === 'string' ? args._[1] : '';
    if (!fromId || !toId) {
        log.errorId('cli.err.locale_rename_usage');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(2) });
    const report = checkLocales({ projectRoot, checkUnused: false });
    const plan = planLocaleRename(report, fromId, toId);
    if (args.json) {
        emitPrettyJson(asJsonTarget(args.json), plan);
    } else if (plan.status !== 'ready') {
        log.error(plan.error || 'rename failed');
    } else {
        log.info(`rename plan ${fromId} → ${toId} edits=${plan.edits.length}`);
        for (const e of plan.edits) console.log(` ${e.path}`);
    }
    return plan.status === 'ready' ? 0 : 1;
}

function cmdLocaleRuntimeCheck(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        log.diagnostics((base.diagnostics || []).filter((x) => x.severity === 'error'));
        return 1;
    }
    const report = checkLocaleRuntime({
        manifest: base.manifest,
        messages: base.messageCatalog?.messages || [],
        applicationId: 'app.locales-fixture',
        deliveryId: 'delivery.web',
        timeZone: typeof args.timezone === 'string' ? args.timezone : 'Asia/Shanghai',
    });
    const { session: _session, ...jsonReport } = report;
    if (args.json) {
        emitJson(args, jsonReport);
    } else {
        log.diagnostics(report.diagnostics ?? []);
        log.info(
            `locale runtime-check: locale=${report.applicationContext?.localeId} digest=${report.formatterDigest} status=${report.status}`,
        );
    }
    return report.status === 'ready' ? 0 : 1;
}

function loadRoutesFixture(projectRoot: string): {
    routes: Array<{ routeId: string; path: string }>;
    origin?: string;
    titles?: Record<string, Record<string, string>>;
} {
    const candidates = [path.join(projectRoot, 'locale-routes.json5'), path.join(projectRoot, 'locale-routes.json')];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const parsed = parseAuthorInput(fs.readFileSync(p, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as {
                    routes: Array<{ routeId: string; path: string }>;
                    origin?: string;
                    titles?: Record<string, Record<string, string>>;
                };
            }
        }
    }
    return {
        routes: [{ routeId: 'index', path: '/' }],
        origin: 'https://example.test',
        titles: {},
    };
}

function cmdLocaleRouterCheck(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        log.diagnostics((base.diagnostics || []).filter((x) => x.severity === 'error'));
        return 1;
    }
    const routesFile = loadRoutesFixture(projectRoot);
    const report = checkLocaleRouter({
        manifest: base.manifest,
        routes: routesFile.routes || [],
        titles: routesFile.titles || {},
        origin: routesFile.origin || 'https://example.test',
    });
    if (args.json) {
        emitJson(args, report);
    } else {
        log.diagnostics(report.diagnostics ?? []);
        const n = report.realizationTable?.realizations?.length || 0;
        log.info(`locale router-check: realizations=${n} pageMetas=${report.pageMetas?.length || 0} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleDeliveryCheck(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        log.diagnostics((base.diagnostics || []).filter((x) => x.severity === 'error'));
        return 1;
    }
    const report = checkLocaleDelivery({
        manifest: base.manifest,
        messages: base.messageCatalog?.messages || [],
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
    });
    if (args.json) {
        emitJson(args, report);
    } else {
        log.diagnostics(report.diagnostics ?? []);
        const hosts = Object.keys(report.resolutions || {}).join(',');
        log.info(`locale delivery-check: hosts=${hosts} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleExplain(args: ParsedOptions): number {
    const messageId = typeof args._[0] === 'string' ? args._[0] : '';
    if (!messageId) {
        log.errorId('cli.err.locale_explain_usage');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(1) });
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        log.diagnostics((base.diagnostics || []).filter((x) => x.severity === 'error'));
        return 1;
    }
    const report = explainLocaleMessage({
        messageId,
        locale: typeof args.locale === 'string' ? args.locale : null,
        deliveryId: typeof args.delivery === 'string' ? args.delivery : null,
        checkReport: base,
    });
    if (args.json) emitJson(args, report);
    else if (report.status !== 'ready') {
        log.diagnostics(report.diagnostics ?? []);
    } else {
        log.info(
            `explain ${report.messageId}: resolved=${report.resolvedLocale} params=${(report.params || []).map((p) => p.name).join(',') || '(none)'}`,
        );
        for (const [loc, v] of Object.entries(report.variants || {})) {
            console.log(` ${loc}\t${v.template}`);
        }
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleDiff(args: ParsedOptions): number {
    const baseLocale = typeof args._[0] === 'string' ? args._[0] : '';
    const targetLocale = typeof args._[1] === 'string' ? args._[1] : '';
    if (!baseLocale || !targetLocale) {
        log.errorId('cli.err.locale_diff_usage');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(2) });
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) return 1;
    const report = diffLocaleCatalogs({
        baseLocale,
        targetLocale,
        messages: base.messageCatalog?.messages || [],
    });
    if (args.json) emitJson(args, report);
    else {
        log.info(
            `diff ${baseLocale} → ${targetLocale}: missing=${report.summary.missingInTarget} changed=${report.summary.changed} params=${report.summary.paramMismatches}`,
        );
        for (const id of report.missingInTarget || []) console.log(` - missing ${id}`);
        for (const c of report.changed || []) console.log(` ~ ${c.messageId}`);
    }
    return 0;
}

function cmdLocaleExtract(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const report = extractHardcodedText(projectRoot, { check: Boolean(args.check) });
    if (args.json) emitJson(args, report);
    else {
        log.diagnostics(report.diagnostics ?? []);
        log.info(`locale extract: findings=${report.findings?.length || 0} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocalePseudo(args: ParsedOptions): number {
    const sourceLocale = typeof args._[0] === 'string' ? args._[0] : '';
    if (!sourceLocale) {
        log.errorId('cli.err.locale_pseudo_usage');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(1) });
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) return 1;
    const report = pseudoLocalizeCatalog({
        sourceLocale,
        messages: base.messageCatalog?.messages || [],
        production: Boolean(args.production),
    });
    if (args.json) emitJson(args, report);
    else if (report.status !== 'ready') {
        log.diagnostics(report.diagnostics ?? []);
    } else {
        const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'locales-pseudo');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${report.pseudoLocale}.json`);
        fs.writeFileSync(outFile, `${generatePrettyJson(report.catalog)}\n`, 'utf8');
        log.info(`locale pseudo: source=${sourceLocale} keys=${Object.keys(report.catalog).length} out=${outFile}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleConformance(args: ParsedOptions): number {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) return 1;
    let routeIds: string[] = [];
    const routesPath = path.join(projectRoot, 'locale-routes.json5');
    if (fs.existsSync(routesPath)) {
        try {
            const routesFile = parseAuthorInput(fs.readFileSync(routesPath, 'utf8'));
            if (routesFile && typeof routesFile === 'object' && !Array.isArray(routesFile) && 'routes' in routesFile) {
                const routes = (routesFile as { routes?: Array<{ routeId?: string }> }).routes || [];
                routeIds = routes.map((r) => String(r.routeId || '')).filter(Boolean);
            }
        } catch {
            /* ignore */
        }
    }
    const report = checkLocaleConformance({
        manifest: base.manifest,
        messages: base.messageCatalog?.messages || [],
        routeIds,
    });
    if (args.json) emitJson(args, report);
    else {
        log.diagnostics(report.diagnostics ?? []);
        log.info(
            `locale conformance: hosts=${(report.hosts || []).join(',')} messages=${report.messageIds?.length || 0} status=${report.status}`,
        );
    }
    return report.status === 'ready' ? 0 : 1;
}

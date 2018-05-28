// @ts-nocheck
/**
 * `vmz locale` CLI (I0–I5).
 * Design: 规划设计/vmz/28 §12
 */
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { parseArgs } from './cli.js';
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
import { log } from './log.js';

function printLocaleHelp() {
    console.log(`vmz locale — /locales application i18n (I0–I5)

Usage:
  vmz locale check [project]       Check locales.json5 + catalogs + param contracts
  vmz locale list [project]        List LocaleIds (manifest order)
  vmz locale emit-types [project]  Emit #locales/* .d.ts stubs (I1)
  vmz locale rename <from> <to>    MessageId rename plan (I1)
  vmz locale runtime-check [project]  LocaleContext / FormatterContext / SSR parity (I2)
  vmz locale router-check [project]   Route realization / canonical / hreflang / PageMeta (I3)
  vmz locale delivery-check [project] Multi-host LocaleDeliveryResolution (I4)
  vmz locale explain <message-id> [project]  Explain MessageId (I5)
  vmz locale diff <base> <target> [project]  Diff two locales (I5)
  vmz locale extract [project]     Hardcoded text sink check (I5)
  vmz locale pseudo <source> [project]  Pseudo-localize catalog (I5, dev/test)
  vmz locale conformance [project] Cross-host MessageId/hash conformance (I5)

Options:
  --root <dir>     Project root (default: . or positional)
  --out <dir>      emit-types / pseudo output
  --locale <id>    explain requested locale
  --delivery <id>  explain delivery id
  --strict         Require variants or explicit fallback for every MessageId
  --check          extract: treat CJK hardcoded as errors
  --production     pseudo: fail (pseudo must not ship)
  --json [file]    Emit check report JSON
`);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function cmdLocale(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
        printLocaleHelp();
        return 0;
    }
    const args = parseArgs(rest);
    switch (sub) {
        case 'check':
            return cmdLocaleCheck(args);
        case 'list':
            return cmdLocaleList(args);
        case 'emit-types':
            return cmdLocaleEmitTypes(args);
        case 'rename':
            return cmdLocaleRename(args);
        case 'runtime-check':
            return cmdLocaleRuntimeCheck(args);
        case 'router-check':
            return cmdLocaleRouterCheck(args);
        case 'delivery-check':
            return cmdLocaleDeliveryCheck(args);
        case 'explain':
            return cmdLocaleExplain(args);
        case 'diff':
            return cmdLocaleDiff(args);
        case 'extract':
            return cmdLocaleExtract(args);
        case 'pseudo':
            return cmdLocalePseudo(args);
        case 'conformance':
            return cmdLocaleConformance(args);
        default:
            log.error(`unknown locale subcommand \`${sub}\``);
            printLocaleHelp();
            return 1;
    }
}

function resolveProject(args) {
    const project = (typeof args.root === 'string' && args.root) || (typeof args._[0] === 'string' && args._[0]) || '.';
    return path.resolve(project);
}

function cmdLocaleCheck(args) {
    const projectRoot = resolveProject(args);
    const report = checkLocales({ projectRoot, strict: Boolean(args.strict) });
    const jsonOut = args.json;
    if (jsonOut) {
        const text = JSON.stringify(report, null, 2);
        if (typeof jsonOut === 'string') {
            fs.writeFileSync(jsonOut, `${text}\n`, 'utf8');
            log.info(`wrote ${jsonOut}`);
        } else {
            console.log(text);
        }
    } else {
        for (const d of report.diagnostics) {
            const loc = d.path ? ` (${d.path})` : '';
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}${loc}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}${loc}`);
        }
        const n = report.messageCatalog?.messages?.length || 0;
        log.info(
            `locale check: locales=${(report.manifest?.locales || []).map((l) => l.id).join(',') || '(none)'} messages=${n} status=${report.status}`,
        );
    }
    return localeHasErrors(report) ? 1 : 0;
}

function cmdLocaleList(args) {
    const projectRoot = resolveProject(args);
    const report = checkLocales({ projectRoot, checkUnused: false });
    if (!report.manifest) {
        log.error('locales.json5 missing');
        return 1;
    }
    for (const loc of report.manifest.locales) {
        const mark = loc.id === report.manifest.defaultLocale ? ' (default)' : '';
        console.log(`${loc.id}\t${loc.label || ''}${mark}`);
    }
    return localeHasErrors(report) ? 1 : 0;
}

function cmdLocaleEmitTypes(args) {
    const projectRoot = resolveProject(args);
    const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'locales-types');
    const report = checkLocales({ projectRoot, strict: Boolean(args.strict) });
    if (localeHasErrors(report)) {
        for (const d of report.diagnostics.filter((x) => x.severity === 'error')) {
            log.error(`${d.code}: ${d.message}`);
        }
        return 1;
    }
    const written = emitLocaleTypedModules(report, outDir);
    log.info(`locale emit-types: modules=${written.length} out=${path.relative(process.cwd(), outDir) || '.'}`);
    return 0;
}

function cmdLocaleRename(args) {
    const fromId = typeof args._[0] === 'string' ? args._[0] : '';
    const toId = typeof args._[1] === 'string' ? args._[1] : '';
    if (!fromId || !toId) {
        log.error('usage: vmz locale rename <from-message-id> <to-message-id>');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(2) });
    const report = checkLocales({ projectRoot, checkUnused: false });
    const plan = planLocaleRename(report, fromId, toId);
    if (args.json) {
        console.log(JSON.stringify(plan, null, 2));
    } else if (plan.status !== 'ready') {
        log.error(plan.error || 'rename failed');
    } else {
        log.info(`rename plan ${fromId} → ${toId} edits=${plan.edits.length}`);
        for (const e of plan.edits) console.log(`  ${e.path}`);
    }
    return plan.status === 'ready' ? 0 : 1;
}

function cmdLocaleRuntimeCheck(args) {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        for (const d of (base.diagnostics || []).filter((x) => x.severity === 'error')) {
            log.error(`${d.code}: ${d.message}`);
        }
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
        const text = JSON.stringify(jsonReport, null, 2);
        if (typeof args.json === 'string') {
            fs.writeFileSync(args.json, `${text}\n`, 'utf8');
            log.info(`wrote ${args.json}`);
        } else {
            console.log(text);
        }
    } else {
        for (const d of report.diagnostics) {
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}`);
        }
        log.info(
            `locale runtime-check: locale=${report.applicationContext?.localeId} digest=${report.formatterDigest} status=${report.status}`,
        );
    }
    return report.status === 'ready' ? 0 : 1;
}

function loadRoutesFixture(projectRoot) {
    const candidates = [path.join(projectRoot, 'locale-routes.json5'), path.join(projectRoot, 'locale-routes.json')];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return JSON5.parse(fs.readFileSync(p, 'utf8'));
        }
    }
    return {
        routes: [{ routeId: 'index', path: '/' }],
        origin: 'https://example.test',
        titles: {},
    };
}

function cmdLocaleRouterCheck(args) {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        for (const d of (base.diagnostics || []).filter((x) => x.severity === 'error')) {
            log.error(`${d.code}: ${d.message}`);
        }
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
        const text = JSON.stringify(report, null, 2);
        if (typeof args.json === 'string') {
            fs.writeFileSync(args.json, `${text}\n`, 'utf8');
            log.info(`wrote ${args.json}`);
        } else {
            console.log(text);
        }
    } else {
        for (const d of report.diagnostics) {
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}`);
        }
        const n = report.realizationTable?.realizations?.length || 0;
        log.info(`locale router-check: realizations=${n} pageMetas=${report.pageMetas?.length || 0} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleDeliveryCheck(args) {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        for (const d of (base.diagnostics || []).filter((x) => x.severity === 'error')) {
            log.error(`${d.code}: ${d.message}`);
        }
        return 1;
    }
    const report = checkLocaleDelivery({
        manifest: base.manifest,
        messages: base.messageCatalog?.messages || [],
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
    });
    if (args.json) {
        const text = JSON.stringify(report, null, 2);
        if (typeof args.json === 'string') {
            fs.writeFileSync(args.json, `${text}\n`, 'utf8');
            log.info(`wrote ${args.json}`);
        } else {
            console.log(text);
        }
    } else {
        for (const d of report.diagnostics) {
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}`);
        }
        const hosts = Object.keys(report.resolutions || {}).join(',');
        log.info(`locale delivery-check: hosts=${hosts} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function emitJson(args, report) {
    const text = JSON.stringify(report, null, 2);
    if (typeof args.json === 'string') {
        fs.writeFileSync(args.json, `${text}\n`, 'utf8');
        log.info(`wrote ${args.json}`);
    } else {
        console.log(text);
    }
}

function cmdLocaleExplain(args) {
    const messageId = typeof args._[0] === 'string' ? args._[0] : '';
    if (!messageId) {
        log.error('usage: vmz locale explain <message-id> [project]');
        return 1;
    }
    const projectRoot = resolveProject({ ...args, _: args._.slice(1) });
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) {
        for (const d of (base.diagnostics || []).filter((x) => x.severity === 'error')) {
            log.error(`${d.code}: ${d.message}`);
        }
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
        for (const d of report.diagnostics) log.error(`${d.code}: ${d.message}`);
    } else {
        log.info(
            `explain ${report.messageId}: resolved=${report.resolvedLocale} params=${(report.params || []).map((p) => p.name).join(',') || '(none)'}`,
        );
        for (const [loc, v] of Object.entries(report.variants || {})) {
            console.log(`  ${loc}\t${v.template}`);
        }
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleDiff(args) {
    const baseLocale = typeof args._[0] === 'string' ? args._[0] : '';
    const targetLocale = typeof args._[1] === 'string' ? args._[1] : '';
    if (!baseLocale || !targetLocale) {
        log.error('usage: vmz locale diff <base-locale> <target-locale> [project]');
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
        for (const id of report.missingInTarget || []) console.log(`  - missing ${id}`);
        for (const c of report.changed || []) console.log(`  ~ ${c.messageId}`);
    }
    return 0;
}

function cmdLocaleExtract(args) {
    const projectRoot = resolveProject(args);
    const report = extractHardcodedText(projectRoot, { check: Boolean(args.check) });
    if (args.json) emitJson(args, report);
    else {
        for (const d of report.diagnostics) {
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}`);
        }
        log.info(`locale extract: findings=${report.findings?.length || 0} status=${report.status}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocalePseudo(args) {
    const sourceLocale = typeof args._[0] === 'string' ? args._[0] : '';
    if (!sourceLocale) {
        log.error('usage: vmz locale pseudo <source-locale> [project]');
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
        for (const d of report.diagnostics) log.error(`${d.code}: ${d.message}`);
    } else {
        const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'locales-pseudo');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${report.pseudoLocale}.json`);
        fs.writeFileSync(outFile, `${JSON.stringify(report.catalog, null, 2)}\n`, 'utf8');
        log.info(`locale pseudo: source=${sourceLocale} keys=${Object.keys(report.catalog).length} out=${outFile}`);
    }
    return report.status === 'ready' ? 0 : 1;
}

function cmdLocaleConformance(args) {
    const projectRoot = resolveProject(args);
    const base = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(base) || !base.manifest) return 1;
    let routeIds = [];
    const routesPath = path.join(projectRoot, 'locale-routes.json5');
    if (fs.existsSync(routesPath)) {
        try {
            const routesFile = JSON5.parse(fs.readFileSync(routesPath, 'utf8'));
            routeIds = (routesFile.routes || []).map((r) => r.routeId);
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
        for (const d of report.diagnostics) {
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}`);
        }
        log.info(
            `locale conformance: hosts=${(report.hosts || []).join(',')} messages=${report.messageIds?.length || 0} status=${report.status}`,
        );
    }
    return report.status === 'ready' ? 0 : 1;
}

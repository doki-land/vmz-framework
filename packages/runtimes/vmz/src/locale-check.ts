/**
 * Locale check + message contracts / typed module projection.
 *
 * Not an I18n IR: filesystem + MessageCatalogManifest projection into VPG-shaped views.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalePlan, mapPlanDiagnostics, parseAuthorInput, type LocalePlan } from './author-input.js';
import {
    DIAG_CATALOG_CONFLICT,
    DIAG_CATALOG_PARSE,
    DIAG_DIR_MISSING,
    DIAG_DIR_ORPHAN,
    DIAG_ID_INVALID,
    DIAG_LAYOUT_ILLEGAL,
    DIAG_MANIFEST_MISSING,
    DIAG_MESSAGE_ARRAY_FORBIDDEN,
    DIAG_MESSAGE_HTML_FORBIDDEN,
    DIAG_MESSAGE_MISSING_DEFAULT,
    DIAG_MESSAGE_MISSING_VARIANT,
    DIAG_MESSAGE_PARAMETER_MISMATCH,
    DIAG_MESSAGE_SYNTAX_INVALID,
    DIAG_MESSAGE_UNUSED,
    LOCALE_CHECK_SCHEMA,
    LOCALE_ID_RE,
    LOCALE_MANIFEST_SCHEMA,
    LOCALE_RESERVED_TOP,
    LOCALE_TYPED_MODULE_SCHEMA,
    LOCALE_VIRTUAL_MODULE_PREFIX,
    MESSAGE_CATALOG_SCHEMA,
    MESSAGE_NODE_SCHEMA,
} from './locale-schema.js';
import { requireNativeAddon } from './native-addon.js';
import { writePrettyJsonFile } from './pretty-json.js';

export interface LocaleDiagnostic {
    code: string;
    severity: string;
    message: string;
    path?: string;
}

export interface MessageParam {
    name: string;
    kind: string;
}

export interface MessageVariant {
    template: string;
    params: MessageParam[];
    path: string;
}

export interface MessageNode {
    messageId: string;
    catalogId: string;
    variants: Record<string, MessageVariant>;
}

/** Fields present on the locale plan wire beyond the minimal `LocalePlan` host type. */
interface LocalePlanData extends LocalePlan {
    locales?: Array<{ id: string; label?: string; direction?: string }>;
    fallback?: Record<string, string[]>;
    missing?: string;
}

export function validateLocaleId(literal: string): { ok: boolean; message?: string } {
    const name = String(literal || '');
    if (!name) return { ok: false, message: 'empty LocaleId' };
    if (name.includes('_')) {
        return { ok: false, message: `LocaleId must use '-' not '_': ${JSON.stringify(name)}` };
    }
    if (name !== name.toLowerCase()) {
        return {
            ok: false,
            message: `LocaleId must be lowercase ASCII (got ${JSON.stringify(name)})`,
        };
    }
    if (!LOCALE_ID_RE.test(name)) {
        return { ok: false, message: `LocaleId is not lowercase BCP 47 form: ${JSON.stringify(name)}` };
    }
    return { ok: true };
}

/**
 * Flatten catalog object into MessageId → string template.
 * Arrays are forbidden.
 */
export function flattenCatalog(node: unknown, prefix: string, diagnostics: LocaleDiagnostic[], sourcePath: string): Map<string, string> {
    const out = new Map<string, string>();
    if (node == null || typeof node !== 'object') {
        diagnostics.push({
            code: DIAG_CATALOG_PARSE,
            severity: 'error',
            message: `catalog root must be an object`,
            path: sourcePath,
        });
        return out;
    }
    if (Array.isArray(node)) {
        diagnostics.push({
            code: DIAG_MESSAGE_ARRAY_FORBIDDEN,
            severity: 'error',
            message: `arrays cannot carry messages (unstable identity)`,
            path: sourcePath,
        });
        return out;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const id = prefix ? `${prefix}.${key}` : key;
        if (value != null && typeof value === 'object') {
            if (Array.isArray(value)) {
                diagnostics.push({
                    code: DIAG_MESSAGE_ARRAY_FORBIDDEN,
                    severity: 'error',
                    message: `array at ${id} cannot carry messages`,
                    path: sourcePath,
                });
                continue;
            }
            for (const [k, v] of flattenCatalog(value, id, diagnostics, sourcePath)) {
                out.set(k, v);
            }
            continue;
        }
        if (typeof value !== 'string') {
            diagnostics.push({
                code: DIAG_CATALOG_PARSE,
                severity: 'error',
                message: `message ${id} must be a string template`,
                path: sourcePath,
            });
            continue;
        }
        if (/<\/?[a-zA-Z]/.test(value) || /javascript:/i.test(value)) {
            diagnostics.push({
                code: DIAG_MESSAGE_HTML_FORBIDDEN,
                severity: 'error',
                message: `message ${id} forbids HTML/JS sinks`,
                path: sourcePath,
            });
        }
        out.set(id, value);
    }
    return out;
}

/**
 * ICU MessageFormat compatible subset: extract argument names + kinds.
 */
export function extractMessageParams(template: string): {
    ok: boolean;
    params: MessageParam[];
    error?: string;
} {
    const text = String(template ?? '');
    const params = new Map<string, string>();
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "'") {
            // apostrophe escape: '' or '…'
            if (text[i + 1] === "'") {
                i += 2;
                continue;
            }
            const end = text.indexOf("'", i + 1);
            if (end < 0) return { ok: false, params: [], error: 'unclosed apostrophe escape' };
            i = end + 1;
            continue;
        }
        if (ch !== '{') {
            i += 1;
            continue;
        }
        const close = findMatchingBrace(text, i);
        if (close < 0) return { ok: false, params: [], error: 'unclosed {' };
        const inner = text.slice(i + 1, close).trim();
        if (inner === '#') {
            i = close + 1;
            continue;
        }
        const parts = splitTopLevel(inner, ',');
        const name = (parts[0] || '').trim();
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            return { ok: false, params: [], error: `invalid argument name in {${inner}}` };
        }
        const kind = (parts[1] || 'string').trim().toLowerCase() || 'string';
        if ((kind === 'plural' || kind === 'select' || kind === 'selectordinal') && !/\bother\b/.test(inner)) {
            return { ok: false, params: [], error: `${kind} requires other` };
        }
        const prev = params.get(name);
        if (prev && prev !== kind) {
            return { ok: false, params: [], error: `argument ${name} kind conflict ${prev} vs ${kind}` };
        }
        params.set(name, kind);
        i = close + 1;
    }
    return {
        ok: true,
        params: [...params.entries()].map(([name, kind]) => ({ name, kind })),
    };
}

function findMatchingBrace(text: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        if (text[i] === "'") {
            if (text[i + 1] === "'") {
                i += 1;
                continue;
            }
            const end = text.indexOf("'", i + 1);
            if (end < 0) return -1;
            i = end;
            continue;
        }
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevel(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (ch === sep && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/** Detect fallback cycles (explicit DAG). */
export function findFallbackCycles(fallback: Record<string, string[]>, known: Set<string>) {
    const cycles: string[] = [];
    const unknown: string[] = [];
    for (const [from, tos] of Object.entries(fallback || {})) {
        if (!known.has(from)) unknown.push(from);
        for (const to of tos || []) {
            if (!known.has(to)) unknown.push(`${from}->${to}`);
        }
    }
    for (const start of Object.keys(fallback || {})) {
        const stack = new Set<string>();
        const path: string[] = [];
        const visit = (node: string) => {
            if (stack.has(node)) {
                cycles.push([...path, node].join(' -> '));
                return;
            }
            if (!fallback[node]) return;
            stack.add(node);
            path.push(node);
            for (const next of fallback[node] || []) visit(next);
            path.pop();
            stack.delete(node);
        };
        visit(start);
    }
    return { cycles: [...new Set(cycles)], unknown: [...new Set(unknown)] };
}

export interface CheckLocalesOpts {
    projectRoot: string;
    strict?: boolean;
    checkUnused?: boolean;
}

export function checkLocales(opts: CheckLocalesOpts) {
    const projectRoot = path.resolve(opts.projectRoot);
    const localesRoot = path.join(projectRoot, 'locales');
    const diagnostics: LocaleDiagnostic[] = [];

    const plan = loadLocalePlan(projectRoot) as LocalePlanData;
    diagnostics.push(...mapPlanDiagnostics(plan.diagnostics));

    const missingManifest = (plan.diagnostics || []).some((d) => d.code === DIAG_MANIFEST_MISSING);
    if (missingManifest || !plan.locales?.length) {
        return emptyReport(projectRoot, diagnostics);
    }

    const localeEntries = plan.locales || [];
    const orderedIds: string[] = localeEntries.map((e) => e.id);
    const seen = new Set(orderedIds);
    const defaultLocale = String(plan.defaultLocale || '');
    const fallback: Record<string, string[]> = plan.fallback && typeof plan.fallback === 'object' ? plan.fallback : {};
    const missingPolicy = plan.missing || 'error';
    const routing = plan.routing || { strategy: 'prefix', defaultPrefix: 'include' };

    const diskLocales: string[] = [];
    if (fs.existsSync(localesRoot)) {
        for (const ent of fs.readdirSync(localesRoot, { withFileTypes: true })) {
            if (LOCALE_RESERVED_TOP.has(ent.name)) continue;
            if (ent.isFile()) {
                diagnostics.push({
                    code: DIAG_LAYOUT_ILLEGAL,
                    severity: 'error',
                    message: `illegal top-level file under /locales: ${ent.name} (only locales.json5 + LocaleId dirs)`,
                    path: `locales/${ent.name}`,
                });
                continue;
            }
            if (!ent.isDirectory()) continue;
            const v = validateLocaleId(ent.name);
            if (!v.ok) {
                diagnostics.push({
                    code: DIAG_ID_INVALID,
                    severity: 'error',
                    message: `directory ${ent.name}: ${v.message}`,
                    path: `locales/${ent.name}`,
                });
                continue;
            }
            diskLocales.push(ent.name);
            if (!seen.has(ent.name)) {
                diagnostics.push({
                    code: DIAG_DIR_ORPHAN,
                    severity: 'error',
                    message: `locale directory ${ent.name} not listed in locales.json5 locales[]`,
                    path: `locales/${ent.name}`,
                });
            }
        }
    }
    for (const id of orderedIds) {
        if (!diskLocales.includes(id)) {
            diagnostics.push({
                code: DIAG_DIR_MISSING,
                severity: 'error',
                message: `locales[] entry ${id} has no locales/${id}/ directory`,
                path: `locales/${id}`,
            });
        }
    }

    const messages = new Map<string, MessageNode>();
    const catalogIds: string[] = [];

    for (const locale of orderedIds) {
        const dir = path.join(localesRoot, locale);
        if (!fs.existsSync(dir)) continue;
        walkCatalogFiles(dir, (fileAbs) => {
            const rel = path.relative(dir, fileAbs).replace(/\\/g, '/');
            const catalogId = rel.replace(/\.(json5|json|ya?ml)$/i, '').replace(/\//g, '.');
            if (!catalogIds.includes(catalogId)) catalogIds.push(catalogId);
            let parsed: unknown = null;
            try {
                const text = fs.readFileSync(fileAbs, 'utf8');
                if (/\.ya?ml$/i.test(fileAbs)) {
                    diagnostics.push({
                        code: DIAG_CATALOG_PARSE,
                        severity: 'warning',
                        message: `YAML catalog ${rel} deferred (I0 first slice: JSON5 only)`,
                        path: path.relative(projectRoot, fileAbs).replace(/\\/g, '/'),
                    });
                    return;
                }
                parsed = parseAuthorInput(text);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                diagnostics.push({
                    code: DIAG_CATALOG_PARSE,
                    severity: 'error',
                    message: `catalog parse failed: ${msg}`,
                    path: path.relative(projectRoot, fileAbs).replace(/\\/g, '/'),
                });
                return;
            }
            const flat = flattenCatalog(parsed, '', diagnostics, path.relative(projectRoot, fileAbs).replace(/\\/g, '/'));
            for (const [key, template] of flat) {
                const messageId = `${catalogId}.${key}`;
                const extracted = extractMessageParams(template);
                if (!extracted.ok) {
                    diagnostics.push({
                        code: DIAG_MESSAGE_SYNTAX_INVALID,
                        severity: 'error',
                        message: `${messageId} @ ${locale}: ${extracted.error}`,
                        path: path.relative(projectRoot, fileAbs).replace(/\\/g, '/'),
                    });
                }
                let node = messages.get(messageId);
                if (!node) {
                    node = { messageId, catalogId, variants: {} };
                    messages.set(messageId, node);
                }
                if (node.variants[locale]) {
                    diagnostics.push({
                        code: DIAG_CATALOG_CONFLICT,
                        severity: 'error',
                        message: `duplicate message ${messageId} in locale ${locale}`,
                        path: path.relative(projectRoot, fileAbs).replace(/\\/g, '/'),
                    });
                }
                node.variants[locale] = {
                    template,
                    params: extracted.ok ? extracted.params : [],
                    path: path.relative(projectRoot, fileAbs).replace(/\\/g, '/'),
                };
            }
        });
    }

    for (const node of messages.values()) {
        if (defaultLocale && !node.variants[defaultLocale]) {
            diagnostics.push({
                code: DIAG_MESSAGE_MISSING_DEFAULT,
                severity: 'error',
                message: `message ${node.messageId} missing in defaultLocale ${defaultLocale}`,
            });
        }
        const base = defaultLocale ? node.variants[defaultLocale] : null;
        const baseSig = base ? paramSignature(base.params) : null;
        for (const [loc, variant] of Object.entries(node.variants)) {
            if (base && loc !== defaultLocale) {
                const sig = paramSignature(variant.params);
                if (sig !== baseSig) {
                    diagnostics.push({
                        code: DIAG_MESSAGE_PARAMETER_MISMATCH,
                        severity: 'error',
                        message: `message ${node.messageId}: params ${sig} @ ${loc} != ${baseSig} @ ${defaultLocale}`,
                        path: variant.path,
                    });
                }
            }
        }
        if (opts.strict) {
            for (const loc of orderedIds) {
                if (!node.variants[loc] && loc !== defaultLocale) {
                    const edges = fallback[loc] || [];
                    const canFallback = edges.some((e) => node.variants[e]);
                    if (!canFallback && missingPolicy !== 'warn') {
                        diagnostics.push({
                            code: DIAG_MESSAGE_MISSING_VARIANT,
                            severity: 'error',
                            message: `message ${node.messageId} missing variant ${loc} (no fallback edge)`,
                        });
                    }
                }
            }
        }
    }

    const used = scanLocaleUsages(projectRoot);
    const typedModules: Array<{
        schema: string;
        module: string;
        catalogId: string;
        exports: Array<{ exportName: string; messageId: string; params: MessageParam[] }>;
    }> = [];
    const byCatalog = new Map<string, MessageNode[]>();
    for (const node of messages.values()) {
        if (!byCatalog.has(node.catalogId)) byCatalog.set(node.catalogId, []);
        byCatalog.get(node.catalogId)!.push(node);
    }
    for (const [catalogId, nodes] of byCatalog) {
        const leafCount = new Map<string, number>();
        for (const n of nodes) {
            const leaf = leafExportName(n.messageId);
            leafCount.set(leaf, (leafCount.get(leaf) || 0) + 1);
        }
        const exports = nodes.map((n) => {
            const leaf = leafExportName(n.messageId);
            const exportName = (leafCount.get(leaf) || 0) > 1 ? n.messageId.slice(catalogId.length + 1).replace(/\./g, '_') : leaf;
            const base = n.variants[defaultLocale] || Object.values(n.variants)[0];
            return {
                exportName,
                messageId: n.messageId,
                params: base?.params || [],
            };
        });
        typedModules.push({
            schema: LOCALE_TYPED_MODULE_SCHEMA,
            module: `${LOCALE_VIRTUAL_MODULE_PREFIX}${catalogId}`,
            catalogId,
            exports,
        });
    }

    if (opts.checkUnused !== false) {
        const referenced = new Set(used.messageIds);
        for (const [catalogId, names] of used.importedNames) {
            for (const name of names) {
                for (const node of messages.values()) {
                    if (node.catalogId !== catalogId) continue;
                    if (leafExportName(node.messageId) === name || node.messageId === `${catalogId}.${name}`) {
                        referenced.add(node.messageId);
                    }
                }
            }
        }
        for (const node of messages.values()) {
            if (!referenced.has(node.messageId) && used.importedNames.size + used.catalogs.size > 0) {
                diagnostics.push({
                    code: DIAG_MESSAGE_UNUSED,
                    severity: 'warning',
                    message: `message ${node.messageId} is never referenced via #locales/*`,
                });
            }
        }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    const messageNodes = [...messages.values()].map((n) => ({
        schema: MESSAGE_NODE_SCHEMA,
        messageId: n.messageId,
        catalogId: n.catalogId,
        variants: Object.fromEntries(
            Object.entries(n.variants).map(([loc, v]) => [loc, { template: v.template, params: v.params, path: v.path }]),
        ),
    }));

    return {
        schema: LOCALE_CHECK_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        root: projectRoot,
        localesRoot: path.relative(projectRoot, localesRoot).replace(/\\/g, '/') || 'locales',
        manifest: {
            schema: LOCALE_MANIFEST_SCHEMA,
            schemaVersion: 1,
            defaultLocale,
            locales: localeEntries,
            fallback,
            routing,
            missing: missingPolicy,
        },
        catalogIds: catalogIds.sort(),
        messageCatalog: {
            schema: MESSAGE_CATALOG_SCHEMA,
            messages: messageNodes,
        },
        typedModules,
        usages: {
            catalogs: [...used.catalogs],
            messageIds: [...used.messageIds],
        },
        diagnostics,
    };
}

function leafExportName(messageId: string): string {
    const parts = String(messageId).split('.');
    return parts[parts.length - 1] || messageId;
}

function paramSignature(params: MessageParam[] | null | undefined): string {
    return (params || [])
        .map((p) => `${p.name}:${p.kind}`)
        .sort()
        .join(',');
}

function emptyReport(projectRoot: string, diagnostics: LocaleDiagnostic[]) {
    const hasErrors = (diagnostics || []).some((d) => d.severity === 'error');
    return {
        schema: LOCALE_CHECK_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        root: projectRoot,
        localesRoot: 'locales',
        manifest: null,
        catalogIds: [],
        messageCatalog: { schema: MESSAGE_CATALOG_SCHEMA, messages: [] },
        typedModules: [],
        usages: { catalogs: [], messageIds: [] },
        diagnostics,
    };
}

function walkCatalogFiles(dir: string, fn: (file: string) => void): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkCatalogFiles(full, fn);
        else if (/\.(json5|json|ya?ml)$/i.test(ent.name)) fn(full);
    }
}

/**
 * Scan src for `#locales/<catalog>` imports and `messageId` string literals after import.
 * First-slice heuristic — full VPG edges land with compiler deepen.
 */
export function scanLocaleUsages(projectRoot: string) {
    const catalogs = new Set<string>();
    const messageIds = new Set<string>();
    const importedNames = new Map<string, Set<string>>();
    const src = path.join(projectRoot, 'src');
    if (!fs.existsSync(src)) return { catalogs, messageIds, importedNames };
    walkSource(src, (file) => {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/#locales\/([A-Za-z0-9_./-]+)/g)) {
            catalogs.add(m[1].replace(/\.ts$/, '').replace(/\/index$/, ''));
        }
        for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]#locales\/([^'"]+)['"]/g)) {
            const catalogId = m[2].replace(/\.ts$/, '');
            catalogs.add(catalogId);
            if (!importedNames.has(catalogId)) importedNames.set(catalogId, new Set());
            for (const part of m[1].split(',')) {
                const name = part
                    .trim()
                    .split(/\s+as\s+/)
                    .pop()
                    ?.trim();
                if (name) {
                    importedNames.get(catalogId)!.add(name);
                    messageIds.add(`${catalogId}.${name}`);
                }
            }
        }
    });
    return { catalogs, messageIds, importedNames };
}

function walkSource(dir: string, fn: (file: string) => void): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkSource(full, fn);
        else if (/\.(vmz|ts|tsx|js|mjs|cjs)$/i.test(ent.name)) fn(full);
    }
}

/** Emit typed module stubs for `#locales/*`. */
export function emitLocaleTypedModules(report: ReturnType<typeof checkLocales>, outDir: string): string[] {
    fs.mkdirSync(outDir, { recursive: true });
    const written: string[] = [];
    const native = requireNativeAddon();
    if (typeof native.generateLocaleTypedModule !== 'function') {
        throw new Error('vmz native addon missing generateLocaleTypedModule — rebuild with `pnpm napi:build`');
    }
    for (const mod of report.typedModules || []) {
        const exports = (mod.exports || []).map((exp) => ({
            exportName: exp.exportName,
            params: (exp.params || []).map((p) => ({ name: p.name, kind: p.kind || 'string' })),
        }));
        const text = native.generateLocaleTypedModule(mod.module, exports);
        const file = path.join(outDir, `${mod.catalogId}.d.ts`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, 'utf8');
        written.push(file);
    }
    const index = {
        schema: LOCALE_TYPED_MODULE_SCHEMA,
        modules: (report.typedModules || []).map((m) => m.module),
        outDir,
    };
    writePrettyJsonFile(path.join(outDir, 'index.json'), index);
    return written;
}

/**
 * Emit runtime `#locales/<catalog>.js` into application `dist/` and rewrite
 * client imports from `#locales/...` to relative ESM paths.
 *
 * Variant pick reads `html[data-locale]` (else defaultLocale). Thin bridge until
 * host LocaleTransition reloads locale-scoped chunks (I2/I4).
 */
export function emitLocaleRuntimeModules(
    projectRoot: string,
    distDir: string,
): { ok: boolean; written: string[]; diagnostics: LocaleDiagnostic[] } {
    const report = checkLocales({ projectRoot, checkUnused: false });
    if (localeHasErrors(report)) {
        return { ok: false, written: [], diagnostics: report.diagnostics || [] };
    }
    // Missing locales.json5 is warning-only for now — surface diagnostics, skip emit.
    if (!report.manifest) {
        return { ok: true, written: [], diagnostics: report.diagnostics || [] };
    }
    const defaultLocale = report.manifest.defaultLocale || 'zh-hans';
    const byId = new Map((report.messageCatalog?.messages || []).map((m) => [m.messageId, m]));
    const written: string[] = [];
    const localesOut = path.join(distDir, 'locales');
    fs.mkdirSync(localesOut, { recursive: true });

    for (const mod of report.typedModules || []) {
        const exports: Array<{ exportName: string; variants: string[][]; hasParams: boolean }> = [];
        for (const exp of mod.exports || []) {
            const node = byId.get(exp.messageId);
            const variants: string[][] = [];
            if (node?.variants) {
                for (const [loc, v] of Object.entries(node.variants) as Array<[string, { template: string }]>) {
                    variants.push([loc, v.template]);
                }
            }
            exports.push({
                exportName: exp.exportName,
                variants,
                hasParams: (exp.params || []).length > 0,
            });
        }
        const native = requireNativeAddon();
        if (typeof native.generateLocaleRuntimeModule !== 'function') {
            throw new Error('vmz native addon missing generateLocaleRuntimeModule — rebuild with `pnpm napi:build`');
        }
        const code = native.generateLocaleRuntimeModule(defaultLocale, exports);
        const file = path.join(localesOut, `${mod.catalogId}.js`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, code, 'utf8');
        written.push(file);
    }

    rewriteLocaleImportsInDist(distDir);
    return { ok: true, written, diagnostics: report.diagnostics || [] };
}

function rewriteLocaleImportsInDist(distDir: string): void {
    const files: string[] = [];
    walkDistJs(distDir, (file) => files.push(file));
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes('#locales/')) continue;
        const fromDir = path.dirname(file);
        // Emit path is dist/locales/*.js — `#` cannot appear in ESM file URLs (fragment).
        const next = text.replace(/from\s*(["'])#locales\/([^"']+)\1/g, (_m, quote, id) => {
            const target = path.join(distDir, 'locales', `${id}.js`);
            let rel = path.relative(fromDir, target).replace(/\\/g, '/');
            if (!rel.startsWith('.')) rel = `./${rel}`;
            return `from ${quote}${rel}${quote}`;
        });
        if (next !== text) fs.writeFileSync(file, next, 'utf8');
    }
}

function walkDistJs(dir: string, fn: (file: string) => void): void {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules') continue;
            walkDistJs(full, fn);
        } else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) {
            fn(full);
        }
    }
}

/** MessageId rename plan — WorkspaceEdit-shaped, no parallel rename IR. */
export function planLocaleRename(report: ReturnType<typeof checkLocales>, fromId: string, toId: string) {
    const node = (report.messageCatalog?.messages || []).find((m) => m.messageId === fromId);
    if (!node) {
        return {
            schema: 'vmz.locale.rename.v0',
            status: 'failed',
            fromId,
            toId,
            edits: [] as Array<{ path: string; kind: string; from: string; to: string }>,
            error: `unknown MessageId ${fromId}`,
        };
    }
    const edits: Array<{ path: string; kind: string; from: string; to: string }> = [];
    for (const variant of Object.values(node.variants || {}) as Array<{ path: string }>) {
        edits.push({
            path: variant.path,
            kind: 'catalog_key',
            from: fromId,
            to: toId,
        });
    }
    return {
        schema: 'vmz.locale.rename.v0',
        status: 'ready',
        fromId,
        toId,
        edits,
        virtualModule: `${LOCALE_VIRTUAL_MODULE_PREFIX}${node.catalogId}`,
    };
}

export function localeHasErrors(report: { diagnostics?: Array<{ severity?: string }> }): boolean {
    return (report.diagnostics || []).some((d) => d.severity === 'error');
}

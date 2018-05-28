// @ts-nocheck
/**
 * Locale I5 tooling: explain · diff · extract · pseudo · cross-host conformance.
 * Design: 规划设计/vmz/28 §12–§13
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    DIAG_LOCALE_CONFORMANCE_DIVERGENCE,
    DIAG_LOCALE_EXPLAIN_UNKNOWN,
    DIAG_LOCALE_HARDCODED_TEXT,
    DIAG_LOCALE_PSEUDO_PRODUCTION_FORBIDDEN,
    DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED,
    FORMATTER_DATA_VERSION,
    LOCALE_CONFORMANCE_SCHEMA,
    LOCALE_DIFF_SCHEMA,
    LOCALE_EXPLAIN_SCHEMA,
    LOCALE_EXTRACT_SCHEMA,
    LOCALE_PSEUDO_SCHEMA,
} from './locale-schema.js';
import { resolveMessageVariant } from './locale-runtime.js';
import { assertHostMessageInvariant, buildLocaleDeliveryResolution } from './locale-delivery.js';

/**
 * Explain one MessageId: definition, params, variants, fallback, delivery reachability.
 * @param {{
 *   messageId: string,
 *   locale?: string|null,
 *   deliveryId?: string|null,
 *   checkReport: any,
 * }} input
 */
export function explainLocaleMessage(input) {
    /** @type {any[]} */
    const diagnostics = [];
    const messages = input.checkReport?.messageCatalog?.messages || [];
    const node = messages.find((m) => m.messageId === input.messageId);
    if (!node) {
        diagnostics.push({
            code: DIAG_LOCALE_EXPLAIN_UNKNOWN,
            severity: 'error',
            message: `unknown MessageId ${input.messageId}`,
        });
        return {
            schema: LOCALE_EXPLAIN_SCHEMA,
            status: 'failed',
            messageId: input.messageId,
            diagnostics,
        };
    }

    const defaultLocale = input.checkReport?.manifest?.defaultLocale;
    const requested = input.locale || defaultLocale;
    const fallback = input.checkReport?.manifest?.fallback || {};
    const resolution = resolveMessageVariant({
        messageId: input.messageId,
        requestedLocale: requested,
        variants: node.variants,
        fallback,
    });

    const base = node.variants?.[defaultLocale] || Object.values(node.variants || {})[0];
    const deliveryId = input.deliveryId || 'delivery.web';
    const delivery = buildLocaleDeliveryResolution({
        host: 'web',
        applicationId: 'app.locales',
        deliveryId,
        supportedLocales: (input.checkReport?.manifest?.locales || []).map((l) => l.id),
        defaultLocale,
        fallback,
        messages,
        reachableMessageIds: [input.messageId],
        bundledLocales: [defaultLocale],
    });
    const inChunk = (delivery.lazyLocaleChunks || []).concat(delivery.bundledChunks || []).some((c) => c.messageIds?.includes(input.messageId));

    return {
        schema: LOCALE_EXPLAIN_SCHEMA,
        status: 'ready',
        messageId: input.messageId,
        catalogId: node.catalogId,
        params: base?.params || [],
        variants: Object.fromEntries(
            Object.entries(node.variants || {}).map(([loc, v]) => [loc, { template: v.template, path: v.path, params: v.params }]),
        ),
        requestedLocale: requested,
        resolvedLocale: resolution.resolvedLocale,
        fallbackPath: resolution.fallbackPath,
        formatterDataVersion: FORMATTER_DATA_VERSION,
        delivery: {
            deliveryId,
            reachable: inChunk,
            catalogHash: delivery.messageCatalogHashes?.[resolution.resolvedLocale || defaultLocale] || null,
            bundledLocales: delivery.bundledLocales,
        },
        diagnostics,
    };
}

/**
 * Diff two locales' catalogs.
 * @param {{
 *   baseLocale: string,
 *   targetLocale: string,
 *   messages: Array<{ messageId: string, variants: Record<string, { template: string, params?: any[] }> }>,
 * }} input
 */
export function diffLocaleCatalogs(input) {
    const base = input.baseLocale;
    const target = input.targetLocale;
    /** @type {any[]} */
    const missingInTarget = [];
    /** @type {any[]} */
    const missingInBase = [];
    /** @type {any[]} */
    const changed = [];
    /** @type {any[]} */
    const paramMismatches = [];

    const ids = new Set();
    for (const m of input.messages || []) ids.add(m.messageId);

    for (const messageId of [...ids].sort()) {
        const node = (input.messages || []).find((m) => m.messageId === messageId);
        const bv = node?.variants?.[base];
        const tv = node?.variants?.[target];
        if (bv && !tv) missingInTarget.push(messageId);
        else if (!bv && tv) missingInBase.push(messageId);
        else if (bv && tv) {
            if (bv.template !== tv.template) {
                changed.push({ messageId, base: bv.template, target: tv.template });
            }
            const bp = JSON.stringify(bv.params || []);
            const tp = JSON.stringify(tv.params || []);
            if (bp !== tp) {
                paramMismatches.push({ messageId, baseParams: bv.params || [], targetParams: tv.params || [] });
            }
        }
    }

    return {
        schema: LOCALE_DIFF_SCHEMA,
        status: 'ready',
        baseLocale: base,
        targetLocale: target,
        missingInTarget,
        missingInBase,
        changed,
        paramMismatches,
        summary: {
            missingInTarget: missingInTarget.length,
            missingInBase: missingInBase.length,
            changed: changed.length,
            paramMismatches: paramMismatches.length,
        },
    };
}

/**
 * Scan source for likely hardcoded UI text sinks (extract --check).
 * Does not auto-generate MessageIds.
 * @param {string} projectRoot
 * @param {{ check?: boolean }} [opts]
 */
export function extractHardcodedText(projectRoot, opts = {}) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const diagnostics = [];
    const srcRoot = path.join(projectRoot, 'src');
    if (!fs.existsSync(srcRoot)) {
        return {
            schema: LOCALE_EXTRACT_SCHEMA,
            status: 'ready',
            findings: [],
            diagnostics: [],
        };
    }

    /** @type {string[]} */
    const files = [];
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === 'node_modules' || ent.name === 'dist') continue;
                walk(p);
            } else if (/\.(vmz|ts|tsx|js|jsx)$/.test(ent.name)) {
                files.push(p);
            }
        }
    };
    walk(srcRoot);

    // CJK or long quoted Latin UI-ish literals outside #locales imports.
    const cjkRe = /['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*)['"`]/g;
    const uiLatinRe = /['"`]([A-Z][A-Za-z0-9 ,.!?]{8,})['"`]/g;
    const dynamicIdRe = /(?<![A-Za-z0-9_$])(?:t|translate|i18n)\(\s*([^'")]+)\s*\)/g;

    for (const fileAbs of files) {
        const text = fs.readFileSync(fileAbs, 'utf8');
        const rel = path.relative(projectRoot, fileAbs).replace(/\\/g, '/');
        // Skip files that only re-export locales types.
        if (rel.includes('locales-types')) continue;

        let m;
        cjkRe.lastIndex = 0;
        while ((m = cjkRe.exec(text))) {
            const lit = m[1];
            // Allow import paths / comments-ish short tokens
            if (lit.includes('#locales/') || lit.includes('locales/')) continue;
            // Require a letter (Latin or CJK). Avoid `\W` without `u` — CJK is `\W` in ASCII mode.
            if (!/\p{L}/u.test(lit)) continue;
            findings.push({
                path: rel,
                kind: 'cjk_literal',
                text: lit,
                suggestion: 'Move UI copy into /locales catalog and import from #locales/*',
            });
            diagnostics.push({
                code: DIAG_LOCALE_HARDCODED_TEXT,
                severity: opts.check ? 'error' : 'warning',
                message: `suspected hardcoded text ${JSON.stringify(lit)} in ${rel}`,
                path: rel,
            });
        }

        uiLatinRe.lastIndex = 0;
        while ((m = uiLatinRe.exec(text))) {
            const lit = m[1];
            if (/^(http|https|application\/|text\/)/i.test(lit)) continue;
            if (lit.includes('#locales/')) continue;
            findings.push({
                path: rel,
                kind: 'ui_literal',
                text: lit,
                suggestion: 'Prefer #locales/* MessageId over hardcoded UI English',
            });
            diagnostics.push({
                code: DIAG_LOCALE_HARDCODED_TEXT,
                severity: 'warning',
                message: `suspected hardcoded UI string ${JSON.stringify(lit)} in ${rel}`,
                path: rel,
            });
        }

        dynamicIdRe.lastIndex = 0;
        while ((m = dynamicIdRe.exec(text))) {
            const arg = m[1].trim();
            if (!/^['"`]/.test(arg)) {
                diagnostics.push({
                    code: DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED,
                    severity: 'error',
                    message: `dynamic message id ${arg} is unbounded; use typed #locales/* exports`,
                    path: rel,
                });
            }
        }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    return {
        schema: LOCALE_EXTRACT_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        findings,
        diagnostics,
    };
}

/**
 * Pseudo-localize a source locale for layout/overflow testing.
 * Preserves ICU placeholders; marks provenance — never a production fallback.
 * @param {{
 *   sourceLocale: string,
 *   messages: Array<{ messageId: string, variants: Record<string, { template: string }> }>,
 *   production?: boolean,
 * }} input
 */
export function pseudoLocalizeCatalog(input) {
    /** @type {any[]} */
    const diagnostics = [];
    if (input.production) {
        diagnostics.push({
            code: DIAG_LOCALE_PSEUDO_PRODUCTION_FORBIDDEN,
            severity: 'error',
            message: 'pseudo locale must not be used as production fallback',
        });
    }

    /** @type {Record<string, string>} */
    const catalog = {};
    for (const m of input.messages || []) {
        const src = m.variants?.[input.sourceLocale]?.template;
        if (src == null) continue;
        // Expand length ~30% with accented padding while keeping {placeholders}.
        const parts = String(src).split(/(\{[^}]+\})/g);
        const out = parts
            .map((p) => {
                if (p.startsWith('{') && p.endsWith('}')) return p;
                const stretched = p.replace(/[A-Za-z]/g, (ch) => `${ch}\u0301`);
                return stretched + (p.trim() ? '·' : '');
            })
            .join('');
        catalog[m.messageId] = `[!! ${out} !!]`;
    }

    return {
        schema: LOCALE_PSEUDO_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        sourceLocale: input.sourceLocale,
        pseudoLocale: `pseudo-${input.sourceLocale}`,
        provenance: 'dev-test-only',
        catalog,
        diagnostics,
    };
}

/**
 * Cross-host conformance: same MessageId set + catalog hashes + formatter version.
 * @param {{
 *   manifest: any,
 *   messages: any[],
 *   routeIds?: string[],
 * }} input
 */
export function checkLocaleConformance(input) {
    /** @type {any[]} */
    const diagnostics = [];
    const supported = (input.manifest?.locales || []).map((l) => l.id);
    const defaultLocale = input.manifest?.defaultLocale;
    const messages = input.messages || [];
    const common = {
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
        supportedLocales: supported,
        defaultLocale,
        fallback: input.manifest?.fallback || {},
        messages,
        reachableMessageIds: messages.map((m) => m.messageId),
        bundledLocales: [defaultLocale],
    };
    const web = buildLocaleDeliveryResolution({ ...common, host: 'web', deliveryId: 'delivery.web' });
    const mini = buildLocaleDeliveryResolution({ ...common, host: 'mini', deliveryId: 'delivery.mini' });
    const native = buildLocaleDeliveryResolution({
        ...common,
        host: 'native',
        deliveryId: 'delivery.native',
    });
    diagnostics.push(...web.diagnostics, ...mini.diagnostics, ...native.diagnostics);

    const inv = assertHostMessageInvariant([web, mini, native]);
    if (!inv.ok) {
        for (const d of inv.diagnostics) {
            diagnostics.push({
                code: DIAG_LOCALE_CONFORMANCE_DIVERGENCE,
                severity: 'error',
                message: d.message,
            });
        }
    }

    // RouteId surface: stable ids must not embed LocaleId.
    for (const routeId of input.routeIds || []) {
        if (supported.some((loc) => routeId.includes(loc))) {
            diagnostics.push({
                code: DIAG_LOCALE_CONFORMANCE_DIVERGENCE,
                severity: 'error',
                message: `RouteId ${routeId} must not embed LocaleId`,
            });
        }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    return {
        schema: LOCALE_CONFORMANCE_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        hosts: ['web', 'mini', 'native'],
        formatterDataVersion: FORMATTER_DATA_VERSION,
        messageIds: messages.map((m) => m.messageId).sort(),
        catalogHashes: web.messageCatalogHashes,
        diagnostics,
    };
}

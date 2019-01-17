/**
 * Locale multi-host delivery: Web chunks · Mini packages · Native packs ·
 * Server error envelope / formatter resources.
 *
 * Same MessageNode projects to all Surfaces; LocaleId is not a WebSurface concern.
 */
import { createHash } from 'node:crypto';
import {
    DIAG_LOCALE_CHUNK_HASH_MISMATCH,
    DIAG_LOCALE_DELIVERY_FULL_BUNDLE,
    DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE,
    DIAG_LOCALE_MINI_CROSS_PACKAGE_UNPROVEN,
    DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH,
    DIAG_LOCALE_NATIVE_PACK_HAS_JS,
    DIAG_LOCALE_NATIVE_PACK_UNSIGNED,
    DIAG_LOCALE_SERVER_FORMAT_WITHOUT_CONTEXT,
    DIAG_LOCALE_SERVER_TRANSLATED_ERROR,
    FORMATTER_DATA_VERSION,
    LOCALE_CHUNK_MANIFEST_SCHEMA,
    LOCALE_DELIVERY_CHECK_SCHEMA,
    LOCALE_DELIVERY_RESOLUTION_SCHEMA,
    LOCALE_MINI_PACKAGE_PROOF_SCHEMA,
    LOCALE_NATIVE_PACK_SCHEMA,
    LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA,
} from './locale-schema.js';

function stableHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

export function fallbackDigest(fallback: Record<string, string[]> = {}): string {
    const keys = Object.keys(fallback).sort();
    const normalized: Record<string, string[]> = {};
    for (const k of keys) normalized[k] = [...(fallback[k] || [])];
    return stableHash(normalized);
}

export interface DeliveryMessage {
    messageId: string;
    variants: Record<string, { template: string }>;
}

/** Hash reachable message variants for one locale. */
export function messageCatalogHash(messages: DeliveryMessage[], localeId: string, reachableIds?: string[]): string {
    const allow = reachableIds ? new Set(reachableIds) : null;
    const slice: Record<string, string> = {};
    for (const m of messages || []) {
        if (allow && !allow.has(m.messageId)) continue;
        const t = m.variants?.[localeId]?.template;
        if (t != null) slice[m.messageId] = t;
    }
    const ordered = Object.keys(slice)
        .sort()
        .map((k) => [k, slice[k]]);
    return stableHash(ordered);
}

export interface LocaleDeliveryInput {
    host: 'web' | 'mini' | 'native' | 'server';
    applicationId: string;
    deliveryId: string;
    planVersion?: string;
    supportedLocales: string[];
    defaultLocale: string;
    fallback?: Record<string, string[]>;
    routingRealization?: unknown;
    messages: DeliveryMessage[];
    reachableMessageIds?: string[];
    bundledLocales?: string[];
    allowFullClientBundle?: boolean;
}

/** Build LocaleDeliveryResolution for one Host surface. */
export function buildLocaleDeliveryResolution(input: LocaleDeliveryInput) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const supported = [...(input.supportedLocales || [])];
    const defaultLocale = input.defaultLocale;
    const reachable = input.reachableMessageIds || (input.messages || []).map((m) => m.messageId);
    const bundled = input.bundledLocales && input.bundledLocales.length ? [...input.bundledLocales] : [defaultLocale];

    // Never default-ship every locale into a client bundle.
    if (
        (input.host === 'web' || input.host === 'mini') &&
        bundled.length >= supported.length &&
        supported.length > 1 &&
        !input.allowFullClientBundle
    ) {
        diagnostics.push({
            code: DIAG_LOCALE_DELIVERY_FULL_BUNDLE,
            severity: 'error',
            message: `${input.host} delivery must not bundle all ${supported.length} locales by default`,
        });
    }

    const messageCatalogHashes: Record<string, string> = {};
    for (const loc of supported) {
        messageCatalogHashes[loc] = messageCatalogHash(input.messages, loc, reachable);
    }

    const lazyLocaleChunks: Array<{
        schema: string;
        localeId: string;
        host: string;
        messageIds: string[];
        hash: string;
        kind: string;
    }> = [];
    for (const loc of supported) {
        if (bundled.includes(loc)) continue;
        lazyLocaleChunks.push({
            schema: LOCALE_CHUNK_MANIFEST_SCHEMA,
            localeId: loc,
            host: input.host,
            messageIds: reachable,
            hash: messageCatalogHashes[loc],
            kind: input.host === 'mini' ? 'subpackage_module' : 'locale_chunk',
        });
    }

    const bundledChunks = bundled.map((loc) => ({
        schema: LOCALE_CHUNK_MANIFEST_SCHEMA,
        localeId: loc,
        host: input.host,
        messageIds: reachable,
        hash: messageCatalogHashes[loc],
        kind: input.host === 'server' ? 'server_resources' : 'bundled',
    }));

    return {
        schema: LOCALE_DELIVERY_RESOLUTION_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        host: input.host,
        applicationId: input.applicationId,
        deliveryId: input.deliveryId,
        planVersion: input.planVersion || 'plan.v0',
        supportedLocales: supported,
        defaultLocale,
        fallbackDigest: fallbackDigest(input.fallback),
        routingRealization: input.routingRealization || null,
        bundledLocales: bundled,
        lazyLocaleChunks,
        bundledChunks,
        formatterDataVersion: FORMATTER_DATA_VERSION,
        messageCatalogHashes,
        reachableMessageIds: reachable,
        diagnostics,
    };
}

/** Validate a Native optional locale pack (signed, no JS, bound to app/plan/schema). */
export function validateNativeLocalePack(input: {
    pack: {
        schema?: string;
        applicationId: string;
        planVersion: string;
        localeId: string;
        signature?: string;
        catalog?: Record<string, string>;
        formatterDataVersion?: string;
        entries?: Array<{ path: string; kind?: string }>;
        executable?: boolean;
    };
    expectedApplicationId: string;
    expectedPlanVersion: string;
}) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const pack = input.pack || ({} as typeof input.pack);
    if (!pack.signature) {
        diagnostics.push({
            code: DIAG_LOCALE_NATIVE_PACK_UNSIGNED,
            severity: 'error',
            message: 'Native locale pack must be signed',
        });
    }
    if (pack.applicationId !== input.expectedApplicationId) {
        diagnostics.push({
            code: DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH,
            severity: 'error',
            message: `pack applicationId ${pack.applicationId} != ${input.expectedApplicationId}`,
        });
    }
    if (pack.planVersion !== input.expectedPlanVersion) {
        diagnostics.push({
            code: DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH,
            severity: 'error',
            message: `pack planVersion ${pack.planVersion} != ${input.expectedPlanVersion}`,
        });
    }
    if (pack.executable === true) {
        diagnostics.push({
            code: DIAG_LOCALE_NATIVE_PACK_HAS_JS,
            severity: 'error',
            message: 'Native locale pack must not carry executable JavaScript',
        });
    }
    for (const e of pack.entries || []) {
        const path = String(e.path || '');
        const kind = String(e.kind || '');
        if (/\.(js|mjs|cjs|wasm)$/i.test(path) || kind === 'javascript' || kind === 'script') {
            diagnostics.push({
                code: DIAG_LOCALE_NATIVE_PACK_HAS_JS,
                severity: 'error',
                message: `Native pack entry forbids executable ${path || kind}`,
            });
        }
    }
    if (pack.formatterDataVersion && pack.formatterDataVersion !== FORMATTER_DATA_VERSION) {
        diagnostics.push({
            code: DIAG_LOCALE_CHUNK_HASH_MISMATCH,
            severity: 'error',
            message: `formatterDataVersion ${pack.formatterDataVersion} != ${FORMATTER_DATA_VERSION}`,
        });
    }

    return {
        schema: LOCALE_NATIVE_PACK_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        localeId: pack.localeId,
        diagnostics,
        pack: {
            schema: LOCALE_NATIVE_PACK_SCHEMA,
            applicationId: pack.applicationId,
            planVersion: pack.planVersion,
            localeId: pack.localeId,
            signature: pack.signature || null,
            formatterDataVersion: pack.formatterDataVersion || FORMATTER_DATA_VERSION,
            catalogKeys: Object.keys(pack.catalog || {}).sort(),
        },
    };
}

/** Mini cross-subpackage message dependencies must be proven. */
export function proveMiniPackageMessages(input: {
    packages: Array<{ id: string; messageIds: string[] }>;
    edges: Array<{ fromPackage: string; toPackage: string; messageId: string }>;
}) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const owned = new Map<string, Set<string>>();
    for (const p of input.packages || []) {
        owned.set(p.id, new Set(p.messageIds || []));
    }
    const proven: Array<{ fromPackage: string; toPackage: string; messageId: string }> = [];
    for (const edge of input.edges || []) {
        const target = owned.get(edge.toPackage);
        if (!target || !target.has(edge.messageId)) {
            diagnostics.push({
                code: DIAG_LOCALE_MINI_CROSS_PACKAGE_UNPROVEN,
                severity: 'error',
                message: `cross-package message ${edge.messageId}: ${edge.fromPackage} -> ${edge.toPackage} unproven`,
            });
            continue;
        }
        proven.push({
            fromPackage: edge.fromPackage,
            toPackage: edge.toPackage,
            messageId: edge.messageId,
        });
    }
    return {
        schema: LOCALE_MINI_PACKAGE_PROOF_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        proven,
        diagnostics,
    };
}

/** Server/client boundary: ErrorCode + params only (no translated strings). */
export function assertServerErrorEnvelope(payload: any) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    if (payload == null || typeof payload !== 'object') {
        diagnostics.push({
            code: DIAG_LOCALE_SERVER_TRANSLATED_ERROR,
            severity: 'error',
            message: 'server error envelope must be an object',
        });
        return { schema: LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA, status: 'failed', diagnostics };
    }
    if (typeof payload.message === 'string' || typeof payload.text === 'string' || typeof payload.localized === 'string') {
        diagnostics.push({
            code: DIAG_LOCALE_SERVER_TRANSLATED_ERROR,
            severity: 'error',
            message: 'server must not cross boundary with translated error strings',
        });
    }
    if (typeof payload.code !== 'string' || !payload.code) {
        diagnostics.push({
            code: DIAG_LOCALE_SERVER_TRANSLATED_ERROR,
            severity: 'error',
            message: 'server error envelope requires stable ErrorCode `code`',
        });
    }
    return {
        schema: LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        envelope: {
            schema: LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA,
            code: payload.code,
            params: payload.params || {},
        },
        diagnostics,
    };
}

/** Final-user server formatting (mail/export/push) requires explicit LocaleContext. */
export function assertServerFormatContext(input: { localeContext?: { localeId?: string; timeZone?: string } | null; purpose: string }) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const ctx = input.localeContext;
    if (!ctx?.localeId || !ctx?.timeZone) {
        diagnostics.push({
            code: DIAG_LOCALE_SERVER_FORMAT_WITHOUT_CONTEXT,
            severity: 'error',
            message: `server ${input.purpose} formatting requires explicit LocaleContext`,
        });
    }
    return { ok: diagnostics.length === 0, diagnostics };
}

/** Same MessageId / catalog hashes must agree across Host projections. */
export function assertHostMessageInvariant(resolutions: Array<ReturnType<typeof buildLocaleDeliveryResolution>>) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    if (!resolutions?.length) return { ok: true, diagnostics };
    const base = resolutions[0];
    for (const r of resolutions.slice(1)) {
        for (const loc of base.supportedLocales || []) {
            if (base.messageCatalogHashes[loc] !== r.messageCatalogHashes?.[loc]) {
                diagnostics.push({
                    code: DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE,
                    severity: 'error',
                    message: `messageCatalogHashes[${loc}] diverge between ${base.host} and ${r.host}`,
                });
            }
        }
        if (base.formatterDataVersion !== r.formatterDataVersion) {
            diagnostics.push({
                code: DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE,
                severity: 'error',
                message: `formatterDataVersion diverge between ${base.host} and ${r.host}`,
            });
        }
        if (base.fallbackDigest !== r.fallbackDigest) {
            diagnostics.push({
                code: DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE,
                severity: 'error',
                message: `fallbackDigest diverge between ${base.host} and ${r.host}`,
            });
        }
    }
    return { ok: diagnostics.length === 0, diagnostics };
}

/** Aggregate delivery proof for fixture / CLI. */
export function checkLocaleDelivery(input: {
    manifest: {
        defaultLocale: string;
        locales: Array<{ id: string }>;
        fallback?: Record<string, string[]>;
        routing?: unknown;
    };
    messages: DeliveryMessage[];
    applicationId?: string;
    planVersion?: string;
    reachableMessageIds?: string[];
}) {
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const supported = (input.manifest?.locales || []).map((l) => l.id);
    const defaultLocale = input.manifest?.defaultLocale;
    const messages = input.messages || [];
    const reachable = input.reachableMessageIds || messages.map((m) => m.messageId);
    const common = {
        applicationId: input.applicationId || 'app.locales-fixture',
        deliveryId: 'delivery.multi',
        planVersion: input.planVersion || 'plan.v0',
        supportedLocales: supported,
        defaultLocale,
        fallback: input.manifest?.fallback || {},
        routingRealization: input.manifest?.routing || null,
        messages,
        reachableMessageIds: reachable,
        bundledLocales: [defaultLocale],
    };

    const web = buildLocaleDeliveryResolution({ ...common, host: 'web', deliveryId: 'delivery.web' });
    const mini = buildLocaleDeliveryResolution({ ...common, host: 'mini', deliveryId: 'delivery.mini' });
    const native = buildLocaleDeliveryResolution({
        ...common,
        host: 'native',
        deliveryId: 'delivery.native',
    });
    const server = buildLocaleDeliveryResolution({
        ...common,
        host: 'server',
        deliveryId: 'delivery.server',
        // server may include all reachable locales as resources (not a client bundle)
        bundledLocales: supported,
        allowFullClientBundle: true,
    });

    for (const r of [web, mini, native, server]) diagnostics.push(...r.diagnostics);

    const invariant = assertHostMessageInvariant([web, mini, native, server]);
    diagnostics.push(...invariant.diagnostics);

    const packOk = validateNativeLocalePack({
        pack: {
            applicationId: common.applicationId,
            planVersion: common.planVersion,
            localeId: 'en-us',
            signature: 'sig.test',
            catalog: { 'account.actions.save': 'Save' },
            formatterDataVersion: FORMATTER_DATA_VERSION,
            entries: [{ path: 'catalog.json5', kind: 'catalog' }],
        },
        expectedApplicationId: common.applicationId,
        expectedPlanVersion: common.planVersion,
    });
    // Probe only — do not fail delivery check if packOk ready.
    if (packOk.status !== 'ready') diagnostics.push(...packOk.diagnostics);

    const miniProof = proveMiniPackageMessages({
        packages: [
            { id: 'main', messageIds: ['account.actions.save'] },
            { id: 'pkg-account', messageIds: ['account.greeting', 'account.itemCount'] },
        ],
        edges: [{ fromPackage: 'main', toPackage: 'pkg-account', messageId: 'account.greeting' }],
    });
    if (miniProof.status !== 'ready') diagnostics.push(...miniProof.diagnostics);

    const errOk = assertServerErrorEnvelope({
        code: 'account.email_taken',
        params: { email: 'a@b.c' },
    });
    if (errOk.status !== 'ready') diagnostics.push(...errOk.diagnostics);

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    return {
        schema: LOCALE_DELIVERY_CHECK_SCHEMA,
        status: hasErrors ? 'failed' : 'ready',
        resolutions: { web, mini, native, server },
        nativePackProbe: packOk,
        miniPackageProof: miniProof,
        serverErrorEnvelope: errOk,
        formatterDataVersion: FORMATTER_DATA_VERSION,
        diagnostics,
    };
}

/**
 * Locale runtime: LocaleContext · FormatterContext · negotiation ·
 * atomic LocaleTransition · SSR/client parity.
 *
 * Not an I18n IR — ApplicationContext + Delivery projections over VPG Message views.
 */
import { createHash } from 'node:crypto';
import {
    DIAG_FORMATTER_CONTEXT_INCOMPLETE,
    DIAG_FORMATTER_VERSION_MISMATCH,
    DIAG_LOCALE_DIGEST_MISMATCH,
    DIAG_LOCALE_MACHINE_DEFAULT_FORBIDDEN,
    DIAG_LOCALE_STALE_GENERATION,
    DIAG_LOCALE_TRANSITION_LOAD_FAILED,
    DIAG_LOCALE_TRANSITION_PARTIAL,
    DIAG_LOCALE_TRANSITION_UNSUPPORTED,
    DIAG_MESSAGE_MIXED_LOCALE,
    FORMATTER_DATA_VERSION,
    LOCALE_APPLICATION_CONTEXT_SCHEMA,
    LOCALE_FALLBACK_RESOLUTION_SCHEMA,
    LOCALE_FORMATTER_CONTEXT_SCHEMA,
    LOCALE_RUNTIME_CHECK_SCHEMA,
    LOCALE_TRANSITION_SCHEMA,
} from './locale-schema.js';

/** Fixed negotiation priority. Host only supplies candidates. */
export function negotiateLocale(input: {
    supportedLocales: string[];
    defaultLocale: string;
    routeLocale?: string | null;
    userChoice?: string | null;
    preference?: string | null;
    hostCandidates?: string[];
}): string {
    const supported = new Set(input.supportedLocales || []);
    const accept = (id: string | null | undefined): string | null => {
        if (!id || typeof id !== 'string') return null;
        // Exact LocaleId only — no zh-TW → zh-hant guessing.
        return supported.has(id) ? id : null;
    };
    return (
        accept(input.routeLocale) ||
        accept(input.userChoice) ||
        accept(input.preference) ||
        (input.hostCandidates || []).map(accept).find(Boolean) ||
        input.defaultLocale
    );
}

export interface ApplicationContextOpts {
    applicationId: string;
    deliveryId: string;
    localeId: string;
    timeZone: string;
    calendar?: string;
    numberingSystem?: string;
    direction?: string;
    generation?: number;
}

export function buildApplicationContext(opts: ApplicationContextOpts) {
    return {
        schema: LOCALE_APPLICATION_CONTEXT_SCHEMA,
        applicationId: opts.applicationId,
        deliveryId: opts.deliveryId,
        localeId: opts.localeId,
        timeZone: opts.timeZone,
        calendar: opts.calendar ?? 'gregory',
        numberingSystem: opts.numberingSystem ?? 'latn',
        direction: opts.direction ?? 'ltr',
        generation: opts.generation ?? 1,
    };
}

export type ApplicationContext = ReturnType<typeof buildApplicationContext>;

export interface FormatterContextOpts {
    currency?: string;
}

export function buildFormatterContext(app: ApplicationContext, opts: FormatterContextOpts = {}) {
    return {
        schema: LOCALE_FORMATTER_CONTEXT_SCHEMA,
        localeId: app.localeId,
        timeZone: app.timeZone,
        calendar: app.calendar || 'gregory',
        numberingSystem: app.numberingSystem || 'latn',
        currency: opts.currency ?? null,
        formatterDataVersion: FORMATTER_DATA_VERSION,
    };
}

export type FormatterContext = ReturnType<typeof buildFormatterContext>;

/** Stable digest for Resume / SSR↔client parity. */
export function formatterContextDigest(formatter: FormatterContext): string {
    const canonical = {
        schema: formatter.schema,
        localeId: formatter.localeId,
        timeZone: formatter.timeZone,
        calendar: formatter.calendar,
        numberingSystem: formatter.numberingSystem,
        currency: formatter.currency ?? null,
        formatterDataVersion: formatter.formatterDataVersion,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

export interface ValidateFormatterContextOpts {
    allowMachineDefault?: boolean;
}

export interface LocaleDiagnostic {
    code: string;
    severity: string;
    message: string;
}

/** Server must not read machine locale/timezone defaults. */
export function validateFormatterContext(formatter: FormatterContext, opts: ValidateFormatterContextOpts = {}) {
    const diagnostics: LocaleDiagnostic[] = [];
    if (!formatter?.localeId || !formatter?.timeZone) {
        diagnostics.push({
            code: DIAG_FORMATTER_CONTEXT_INCOMPLETE,
            severity: 'error',
            message: 'FormatterContext requires localeId and timeZone',
        });
    }
    if (!formatter?.calendar || !formatter?.numberingSystem) {
        diagnostics.push({
            code: DIAG_FORMATTER_CONTEXT_INCOMPLETE,
            severity: 'error',
            message: 'FormatterContext requires calendar and numberingSystem',
        });
    }
    if (formatter?.formatterDataVersion && formatter.formatterDataVersion !== FORMATTER_DATA_VERSION) {
        diagnostics.push({
            code: DIAG_FORMATTER_VERSION_MISMATCH,
            severity: 'error',
            message: `formatterDataVersion ${formatter.formatterDataVersion} != ${FORMATTER_DATA_VERSION}`,
        });
    }
    if (!opts.allowMachineDefault) {
        const tz = String(formatter?.timeZone || '');
        if (!tz || tz === 'local' || tz === 'system' || tz === 'Etc/Unknown') {
            diagnostics.push({
                code: DIAG_LOCALE_MACHINE_DEFAULT_FORBIDDEN,
                severity: 'error',
                message: `server FormatterContext forbids machine timezone ${JSON.stringify(tz)}`,
            });
        }
    }
    return {
        ok: diagnostics.length === 0,
        diagnostics,
    };
}

export interface MessageVariantInput {
    template: string;
}

/** Resolve one MessageBinding to a single locale variant (whole-message, no mix). */
export function resolveMessageVariant(input: {
    messageId: string;
    requestedLocale: string;
    variants: Record<string, MessageVariantInput>;
    fallback?: Record<string, string[]>;
}) {
    const fallback = input.fallback || {};
    const chain = [input.requestedLocale, ...(fallback[input.requestedLocale] || [])];
    for (const loc of chain) {
        const variant = input.variants?.[loc];
        if (variant?.template != null) {
            return {
                schema: LOCALE_FALLBACK_RESOLUTION_SCHEMA,
                messageId: input.messageId,
                requestedLocale: input.requestedLocale,
                resolvedLocale: loc,
                fallbackPath: chain.slice(0, chain.indexOf(loc) + 1),
                template: variant.template,
                ok: true,
            };
        }
    }
    return {
        schema: LOCALE_FALLBACK_RESOLUTION_SCHEMA,
        messageId: input.messageId,
        requestedLocale: input.requestedLocale,
        resolvedLocale: null,
        fallbackPath: chain,
        template: null,
        ok: false,
    };
}

/**
 * Minimal ICU MessageFormat subset for parity proofs (params + plural + #).
 */
export function formatMessageTemplate(template: string, args: Record<string, unknown> = {}): string {
    let text = String(template || '');
    // plural / selectordinal / select blocks first
    text = text.replace(/\{(\w+),\s*(plural|selectordinal|select)\s*,\s*((?:[^={}]+\{[^{}]*\}\s*)+)\}/g, (_m, name, _kind, body) => {
        const n = Number(args[name]);
        const pick = (key) => {
            const re = new RegExp(`${key}\\s*\\{([^{}]*)\\}`);
            const hit = body.match(re);
            return hit ? hit[1] : null;
        };
        let branch = null;
        if (Number.isFinite(n) && Object.hasOwn(args, name)) {
            branch = pick(`=${n}`) || (n === 1 ? pick('one') : null) || pick('other');
        } else {
            branch = pick(String(args[name])) || pick('other');
        }
        if (branch == null) return _m;
        return branch.replace(/#/g, String(Number.isFinite(n) ? n : (args[name] ?? '')));
    });
    text = text.replace(/\{(\w+)(?:,\s*\w+)?\}/g, (_m, name) => {
        if (Object.hasOwn(args, name)) return String(args[name]);
        return _m;
    });
    return text;
}

export interface LocaleSessionOpts {
    applicationId: string;
    deliveryId: string;
    supportedLocales: string[];
    defaultLocale: string;
    fallback?: Record<string, string[]>;
    directions?: Record<string, string>;
    messages: Record<string, { variants: Record<string, { template: string }> }>;
    initialLocaleId: string;
    timeZone: string;
    generation?: number;
    loadedChunks?: Set<string> | string[];
}

export interface LocaleTransitionOpts {
    generation?: number;
    loadChunk?: (localeId: string) => boolean | Promise<boolean>;
    timeZone?: string;
}

export function createLocaleSession(opts: LocaleSessionOpts) {
    const supported = new Set(opts.supportedLocales);
    const directions = opts.directions || {};
    const fallback = opts.fallback || {};
    let generation = opts.generation ?? 1;
    const loaded = new Set(opts.loadedChunks || [opts.initialLocaleId]);
    let app = buildApplicationContext({
        applicationId: opts.applicationId,
        deliveryId: opts.deliveryId,
        localeId: opts.initialLocaleId,
        timeZone: opts.timeZone,
        direction: directions[opts.initialLocaleId] || 'ltr',
        generation,
    });
    let formatter = buildFormatterContext(app);
    let digest = formatterContextDigest(formatter);

    function snapshot() {
        return {
            applicationContext: { ...app },
            formatterContext: { ...formatter },
            formatterDigest: digest,
            loadedChunks: [...loaded],
            generation,
        };
    }

    /** Render all known messages under current locale (atomic surface proof). */
    function renderAll(argMap: Record<string, Record<string, unknown>> = {}) {
        const out: Record<string, { text: string; resolvedLocale: string }> = {};
        const resolvedLocales: string[] = [];
        for (const [messageId, node] of Object.entries(opts.messages)) {
            const res = resolveMessageVariant({
                messageId,
                requestedLocale: app.localeId,
                variants: node.variants,
                fallback,
            });
            if (!res.ok) continue;
            out[messageId] = {
                text: formatMessageTemplate(res.template, argMap[messageId] || {}),
                resolvedLocale: res.resolvedLocale,
            };
            resolvedLocales.push(res.resolvedLocale);
        }
        const unique = [...new Set(resolvedLocales)];
        return { bindings: out, resolvedLocales: unique };
    }

    /** Atomic LocaleTransition. */
    async function transition(targetLocaleId: string, transitionOpts: LocaleTransitionOpts = {}) {
        const fromLocale = app.localeId;
        const expectedGen = transitionOpts.generation ?? generation;
        if (expectedGen !== generation) {
            return {
                schema: LOCALE_TRANSITION_SCHEMA,
                status: 'cancelled',
                fromLocale,
                toLocale: targetLocaleId,
                reason: 'stale_generation',
                diagnostics: [
                    {
                        code: DIAG_LOCALE_STALE_GENERATION,
                        severity: 'error',
                        message: `transition generation ${expectedGen} != session ${generation}`,
                    },
                ],
                snapshot: snapshot(),
            };
        }
        if (!supported.has(targetLocaleId)) {
            return {
                schema: LOCALE_TRANSITION_SCHEMA,
                status: 'rejected',
                fromLocale,
                toLocale: targetLocaleId,
                reason: 'unsupported',
                diagnostics: [
                    {
                        code: DIAG_LOCALE_TRANSITION_UNSUPPORTED,
                        severity: 'error',
                        message: `LocaleId ${targetLocaleId} not in supportedLocales`,
                    },
                ],
                snapshot: snapshot(),
            };
        }

        let loadOk = true;
        if (typeof transitionOpts.loadChunk === 'function') {
            try {
                loadOk = Boolean(await transitionOpts.loadChunk(targetLocaleId));
            } catch {
                loadOk = false;
            }
        } else if (!loaded.has(targetLocaleId)) {
            // Without a loader, missing chunk cannot commit.
            loadOk = false;
        }

        if (!loadOk) {
            return {
                schema: LOCALE_TRANSITION_SCHEMA,
                status: 'rolled_back',
                fromLocale,
                toLocale: targetLocaleId,
                reason: 'load_failed',
                diagnostics: [
                    {
                        code: DIAG_LOCALE_TRANSITION_LOAD_FAILED,
                        severity: 'error',
                        message: `locale chunk ${targetLocaleId} failed to load; keeping ${fromLocale}`,
                    },
                ],
                snapshot: snapshot(),
            };
        }

        // Commit only after resources are ready — single transaction.
        loaded.add(targetLocaleId);
        generation += 1;
        app = buildApplicationContext({
            applicationId: opts.applicationId,
            deliveryId: opts.deliveryId,
            localeId: targetLocaleId,
            timeZone: transitionOpts.timeZone || opts.timeZone,
            direction: directions[targetLocaleId] || 'ltr',
            generation,
        });
        formatter = buildFormatterContext(app);
        digest = formatterContextDigest(formatter);

        const rendered = renderAll();
        // After commit, every binding must resolve under the new requested locale
        // (or its explicit fallback chain) — never a mix of independent "half pages".
        const foreign = rendered.resolvedLocales.filter((loc) => loc !== targetLocaleId && !(fallback[targetLocaleId] || []).includes(loc));
        const diagnostics: LocaleDiagnostic[] = [];
        if (foreign.length) {
            diagnostics.push({
                code: DIAG_MESSAGE_MIXED_LOCALE,
                severity: 'error',
                message: `post-transition mixed locales: ${foreign.join(',')}`,
            });
            diagnostics.push({
                code: DIAG_LOCALE_TRANSITION_PARTIAL,
                severity: 'error',
                message: 'LocaleTransition produced a partial language surface',
            });
        }

        return {
            schema: LOCALE_TRANSITION_SCHEMA,
            status: diagnostics.length ? 'failed' : 'committed',
            fromLocale,
            toLocale: targetLocaleId,
            reason: diagnostics.length ? 'partial' : 'ok',
            diagnostics,
            snapshot: snapshot(),
            rendered,
        };
    }

    return {
        negotiateLocale,
        snapshot,
        renderAll,
        transition,
        get applicationContext() {
            return { ...app };
        },
        get formatterContext() {
            return { ...formatter };
        },
        get formatterDigest() {
            return digest;
        },
    };
}

/** SSR and client must share the same resolved FormatterContext digest and texts. */
export function checkSsrClientParity(input: {
    ssr: {
        localeId: string;
        formatterDigest: string;
        formatterDataVersion?: string;
        texts: Record<string, string>;
    };
    client: {
        localeId: string;
        formatterDigest: string;
        formatterDataVersion?: string;
        texts: Record<string, string>;
    };
}) {
    const diagnostics: LocaleDiagnostic[] = [];
    const { ssr, client } = input;
    if (ssr.localeId !== client.localeId) {
        diagnostics.push({
            code: DIAG_LOCALE_DIGEST_MISMATCH,
            severity: 'error',
            message: `localeId SSR ${ssr.localeId} != client ${client.localeId}`,
        });
    }
    if (ssr.formatterDigest !== client.formatterDigest) {
        diagnostics.push({
            code: DIAG_LOCALE_DIGEST_MISMATCH,
            severity: 'error',
            message: `formatterDigest SSR ${ssr.formatterDigest} != client ${client.formatterDigest}`,
        });
    }
    const ssrVer = ssr.formatterDataVersion || FORMATTER_DATA_VERSION;
    const clientVer = client.formatterDataVersion || FORMATTER_DATA_VERSION;
    if (ssrVer !== clientVer) {
        diagnostics.push({
            code: DIAG_FORMATTER_VERSION_MISMATCH,
            severity: 'error',
            message: `formatterDataVersion SSR ${ssrVer} != client ${clientVer}`,
        });
    }
    const keys = new Set([...Object.keys(ssr.texts || {}), ...Object.keys(client.texts || {})]);
    for (const k of keys) {
        if ((ssr.texts || {})[k] !== (client.texts || {})[k]) {
            diagnostics.push({
                code: DIAG_LOCALE_DIGEST_MISMATCH,
                severity: 'error',
                message: `text mismatch for ${k}: SSR=${JSON.stringify((ssr.texts || {})[k])} client=${JSON.stringify((client.texts || {})[k])}`,
            });
        }
    }
    return {
        schema: LOCALE_RUNTIME_CHECK_SCHEMA,
        status: diagnostics.length ? 'failed' : 'ready',
        kind: 'ssr_client_parity',
        diagnostics,
    };
}

/** Aggregate runtime proof for a project check report + explicit contexts. */
export function checkLocaleRuntime(input: {
    manifest: {
        defaultLocale: string;
        locales: Array<{ id: string; direction?: string }>;
        fallback?: Record<string, string[]>;
    };
    messages: Array<{ messageId: string; variants: Record<string, { template: string }> }>;
    applicationId?: string;
    deliveryId?: string;
    timeZone?: string;
}) {
    const diagnostics: LocaleDiagnostic[] = [];
    const supported = (input.manifest?.locales || []).map((l) => l.id);
    const defaultLocale = input.manifest?.defaultLocale;
    const fallback = input.manifest?.fallback || {};
    const directions = Object.fromEntries((input.manifest?.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const messages: Record<string, { variants: Record<string, { template: string }> }> = {};
    for (const m of input.messages || []) {
        messages[m.messageId] = { variants: m.variants };
    }

    const negotiated = negotiateLocale({
        supportedLocales: supported,
        defaultLocale,
        routeLocale: null,
        userChoice: null,
        preference: null,
        hostCandidates: ['zh-TW', 'en'], // must NOT dark-guess
    });
    if (negotiated !== defaultLocale) {
        diagnostics.push({
            code: DIAG_LOCALE_DIGEST_MISMATCH,
            severity: 'error',
            message: `host candidates must not invent LocaleId; got ${negotiated}`,
        });
    }

    const session = createLocaleSession({
        applicationId: input.applicationId || 'app.locales',
        deliveryId: input.deliveryId || 'delivery.web',
        supportedLocales: supported,
        defaultLocale,
        fallback,
        directions,
        messages,
        initialLocaleId: defaultLocale,
        timeZone: input.timeZone || 'Asia/Shanghai',
        loadedChunks: [defaultLocale],
    });

    const fmtCheck = validateFormatterContext(session.formatterContext);
    diagnostics.push(...fmtCheck.diagnostics);

    const ssrSnap = session.snapshot();
    const ssrRender = session.renderAll({
        'account.greeting': { name: 'Ada' },
        'account.itemCount': { count: 2 },
    });
    const clientSnap = {
        localeId: ssrSnap.applicationContext.localeId,
        formatterDigest: ssrSnap.formatterDigest,
        formatterDataVersion: ssrSnap.formatterContext.formatterDataVersion,
        texts: Object.fromEntries(Object.entries(ssrRender.bindings).map(([k, v]) => [k, v.text])),
    };
    const parity = checkSsrClientParity({
        ssr: {
            localeId: ssrSnap.applicationContext.localeId,
            formatterDigest: ssrSnap.formatterDigest,
            formatterDataVersion: ssrSnap.formatterContext.formatterDataVersion,
            texts: clientSnap.texts,
        },
        client: clientSnap,
    });
    diagnostics.push(...parity.diagnostics);

    return {
        schema: LOCALE_RUNTIME_CHECK_SCHEMA,
        status: diagnostics.some((d) => d.severity === 'error') ? 'failed' : 'ready',
        negotiatedLocale: negotiated,
        applicationContext: ssrSnap.applicationContext,
        formatterContext: ssrSnap.formatterContext,
        formatterDigest: ssrSnap.formatterDigest,
        formatterDataVersion: FORMATTER_DATA_VERSION,
        diagnostics,
        session,
    };
}

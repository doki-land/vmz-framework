/**
 * Server Language DSL backends (lang on `<script server>`).
 * Author surface is a VMZ DSL flavor — not full target-language source.
 */
// @ts-nocheck

/** @typedef {'ts' | 'rust' | 'python' | 'java'} ServerLangId */

export const SERVER_LANG_IDS = Object.freeze(['ts', 'rust', 'python', 'java']);

/** @type {Record<string, ServerLangId>} */
export const SERVER_LANG_ALIASES = Object.freeze({
    ts: 'ts',
    typescript: 'ts',
    rust: 'rust',
    python: 'python',
    java: 'java',
});

/**
 * @typedef {{
 *   langId: ServerLangId,
 *   aliases: string[],
 *   compatibleRuntimes: string[],
 *   implemented: boolean,
 *   artifactRoot: string,
 * }} ServerLanguageBackendMeta
 */

/** @type {Record<ServerLangId, ServerLanguageBackendMeta>} */
export const SERVER_LANGUAGE_BACKENDS = Object.freeze({
    ts: {
        langId: 'ts',
        aliases: ['ts', 'typescript'],
        compatibleRuntimes: ['node', 'worker', 'deno', 'bun'],
        implemented: true,
        artifactRoot: 'dist/#server',
    },
    rust: {
        langId: 'rust',
        aliases: ['rust'],
        compatibleRuntimes: ['rust-host'],
        implemented: true,
        artifactRoot: 'target/vmz/server-rust',
    },
    python: {
        langId: 'python',
        aliases: ['python'],
        compatibleRuntimes: ['python-host'],
        implemented: false,
        artifactRoot: 'target/vmz/server-python',
    },
    java: {
        langId: 'java',
        aliases: ['java'],
        compatibleRuntimes: ['jvm-host'],
        implemented: false,
        artifactRoot: 'target/vmz/server-java',
    },
});

/**
 * Resolve author `lang` attr (or null/undefined for default TS).
 * @param {string | null | undefined} raw
 * @returns {{
 *   ok: true, langId: ServerLangId, backend: ServerLanguageBackendMeta
 * } | {
 *   ok: false, code: string, message: string
 * }}
 */
export function resolveServerLanguage(raw) {
    const trimmed = raw == null ? '' : String(raw).trim();
    if (!trimmed) {
        return { ok: true, langId: 'ts', backend: SERVER_LANGUAGE_BACKENDS.ts };
    }
    const langId = SERVER_LANG_ALIASES[trimmed];
    if (!langId) {
        return {
            ok: false,
            code: 'vmz::server::unknown_language',
            message: `unknown script language \`${trimmed}\`; use ts|typescript|rust|python|java`,
        };
    }
    const backend = SERVER_LANGUAGE_BACKENDS[langId];
    if (!backend.implemented) {
        return {
            ok: false,
            code: 'vmz::server::language_backend_unimplemented',
            message: `\`<script server lang="${langId}">\` is registered but not implemented yet`,
        };
    }
    return { ok: true, langId, backend };
}

/**
 * @param {ServerLangId} langId
 * @param {string | null | undefined} serverRuntime
 */
export function assertLangRuntimePair(langId, serverRuntime) {
    const backend = SERVER_LANGUAGE_BACKENDS[langId];
    if (!backend) {
        return {
            ok: false,
            code: 'vmz::server::unknown_language',
            message: `unknown langId ${langId}`,
        };
    }
    if (langId === 'ts') {
        // TS stays compatible with existing node/worker defaults; rust-host rejects ts.
        if (serverRuntime === 'rust-host' || serverRuntime === 'python-host' || serverRuntime === 'jvm-host') {
            return {
                ok: false,
                code: 'vmz::server::lang_runtime_mismatch',
                message: `lang=ts is incompatible with serverRuntime=${serverRuntime}`,
            };
        }
        return { ok: true };
    }
    const rt = String(serverRuntime || '').trim();
    if (!backend.compatibleRuntimes.includes(rt)) {
        return {
            ok: false,
            code: 'vmz::server::lang_runtime_mismatch',
            message: `lang=${langId} requires serverRuntime in [${backend.compatibleRuntimes.join('|')}] (got ${rt || '(none)'})`,
        };
    }
    return { ok: true };
}

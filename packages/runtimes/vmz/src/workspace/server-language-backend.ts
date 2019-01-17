/**
 * Server Language DSL backends (lang on `<script server>`).
 * Author surface is a VMZ DSL flavor — not full target-language source.
 */

export type ServerLangId = 'ts' | 'rust' | 'python' | 'java';

export const SERVER_LANG_IDS = Object.freeze(['ts', 'rust', 'python', 'java'] as const);

export const SERVER_LANG_ALIASES: Record<string, ServerLangId> = Object.freeze({
    ts: 'ts',
    typescript: 'ts',
    rust: 'rust',
    python: 'python',
    java: 'java',
});

export interface ServerLanguageBackendMeta {
    langId: ServerLangId;
    aliases: string[];
    compatibleRuntimes: string[];
    implemented: boolean;
    artifactRoot: string;
}

export const SERVER_LANGUAGE_BACKENDS: Record<ServerLangId, ServerLanguageBackendMeta> = Object.freeze({
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

export type ResolveServerLanguageResult =
    | { ok: true; langId: ServerLangId; backend: ServerLanguageBackendMeta }
    | { ok: false; code: string; message: string };

export function resolveServerLanguage(raw: string | null | undefined): ResolveServerLanguageResult {
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

export function assertLangRuntimePair(
    langId: ServerLangId,
    serverRuntime: string | null | undefined,
): { ok: true } | { ok: false; code: string; message: string } {
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

/**
 * Env for spawning `dist/vmz-serve-host.mjs`.
 * Mirrors `vmz serve` / `vmz dev` (`VMZ_NATIVE_NODE`); copied hosts cannot
 * resolve `@vmz/vmz-<platform>` from an example `dist/` alone.
 */

import { resolveNativePath } from 'vmz';

export function serveHostChildEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        VMZ_NATIVE_NODE: resolveNativePath(),
        ...extra,
    };
}

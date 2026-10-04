/**
 * Cloudflare Worker entry — delegates to VMZ handleFetchRequest on staged dist.
 * Staged by scripts/stage-vmz-dist.mjs (pnpm home:server).
 */

import routes from './vmz-dist/vmz-routes.json';
import { resolveServerModule } from './module-registry.generated.js';

type VmzRuntime = {
    setServerModuleResolver: (fn: (moduleId: string) => string | URL) => void;
    setRoutes: (next: unknown[]) => void;
    handleFetchRequest: (request: Request) => Promise<Response>;
};

let runtimePromise: Promise<VmzRuntime> | undefined;

async function loadRuntime(): Promise<VmzRuntime> {
    if (!runtimePromise) {
        runtimePromise = import('./vmz-dist/vmz-runtime.js') as Promise<VmzRuntime>;
    }
    return runtimePromise;
}

let booted = false;

async function boot(): Promise<VmzRuntime> {
    const runtime = await loadRuntime();
    if (!booted) {
        runtime.setServerModuleResolver(resolveServerModule);
        runtime.setRoutes(routes as unknown[]);
        booted = true;
    }
    return runtime;
}

export default {
    async fetch(request: Request): Promise<Response> {
        const runtime = await boot();
        return runtime.handleFetchRequest(request);
    },
};

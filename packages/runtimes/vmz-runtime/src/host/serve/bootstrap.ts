import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setServerModuleResolver } from '../../faces/vmz-runtime.js';
import { installDevImportTokenHooks, normalizeDevError, softReload } from './hmr-dev.js';
import { bustUrl } from './page-catalog.js';
import { installAppModuleResolveHooks } from './paths.js';
import { serveState } from './state.js';

export async function bootstrapServeHost() {
    installAppModuleResolveHooks();
    globalThis.__VMZ_RPC_ORIGIN = `http://${serveState.host}:${serveState.port}`;
    installDevImportTokenHooks();
    setServerModuleResolver((moduleId) => {
        const rel = moduleId.replace(/^#server\//, '') + '.js';
        return bustUrl(pathToFileURL(path.join(serveState.distDir, '#server', rel)).href);
    });
    try {
        await softReload({ quiet: true });
        serveState.ready = true;
    } catch (err) {
        serveState.lastDevError = normalizeDevError(err);
        serveState.ready = true;
        console.error('vmz serve: initial load failed (dev host stays up)', serveState.lastDevError.message);
    }
}

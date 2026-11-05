import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setServerModuleResolver } from '../../faces/vmz-runtime.js';
import { commitReload, installDevImportTokenHooks, normalizeDevError, prepareReload } from './hmr-dev.js';
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
    // dev：入口模块写好后必须由 CLI 侧 pack 再 commit，host 自己不能置 ready。
    // 生产 serve：pack 已在构建期完成，直接 prepare + commit。
    if (serveState.isDev) return;
    try {
        await prepareReload({ quiet: true });
        commitReload();
    } catch (err) {
        serveState.lastDevError = normalizeDevError(err);
        serveState.ready = true;
        console.error('vmz serve: initial load failed (host stays up)', serveState.lastDevError.message);
    }
}

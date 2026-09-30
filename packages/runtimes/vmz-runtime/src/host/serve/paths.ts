import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveState } from './state.js';

const require = createRequire(import.meta.url);

export function projectRootForResolve() {
    const fromEnv = typeof process.env.VMZ_PROJECT_ROOT === 'string' ? process.env.VMZ_PROJECT_ROOT.trim() : '';
    if (fromEnv) return path.resolve(fromEnv);
    return process.cwd();
}

export function appPackageRequireResolve() {
    if (!serveState.appPackageRequire) {
        const root = projectRootForResolve();
        const pkg = path.join(root, 'package.json');
        serveState.appPackageRequire = existsSync(pkg) ? createRequire(pkg) : require;
    }
    return serveState.appPackageRequire;
}

export function installAppModuleResolveHooks() {
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (
                !specifier ||
                specifier.startsWith('.') ||
                specifier.startsWith('node:') ||
                specifier.startsWith('file:') ||
                specifier.startsWith('#')
            ) {
                return nextResolve(specifier, context);
            }
            if (context.parentURL?.startsWith('file:')) {
                try {
                    const parentPath = fileURLToPath(context.parentURL);
                    if (!parentPath.startsWith(serveState.distDir + path.sep)) return nextResolve(specifier, context);
                } catch {
                    return nextResolve(specifier, context);
                }
            }
            try {
                const appParent = pathToFileURL(path.join(projectRootForResolve(), 'package.json')).href;
                return nextResolve(specifier, { ...context, parentURL: appParent });
            } catch {
                // Some legacy packages expose only a CommonJS entry.
            }
            try {
                const resolved = appPackageRequireResolve().resolve(specifier);
                return { url: pathToFileURL(resolved).href, shortCircuit: true };
            } catch {
                return nextResolve(specifier, context);
            }
        },
        load(url, context, nextLoad) {
            const pathOnly = url.split('?')[0].split('#')[0];
            if (!pathOnly.endsWith('.json')) return nextLoad(url, context);
            try {
                const filePath = fileURLToPath(pathOnly);
                const raw = readFileSync(filePath, 'utf8');
                return {
                    format: 'module',
                    shortCircuit: true,
                    source: `export default ${raw}`,
                };
            } catch {
                return nextLoad(url, context);
            }
        },
    });
}

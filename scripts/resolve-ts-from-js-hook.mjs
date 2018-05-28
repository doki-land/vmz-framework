/**
 * ESM resolve hook: prefer `foo.ts` when importer asks for `foo.js` and `.ts` exists.
 */
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(s: string, c: object) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js') && !specifier.startsWith('node:')) {
        try {
            const url = new URL(specifier, context.parentURL ?? pathToFileURL(`${process.cwd()}/`));
            const jsPath = fileURLToPath(url);
            if (!fs.existsSync(jsPath)) {
                const tsPath = jsPath.replace(/\.js$/i, '.ts');
                if (fs.existsSync(tsPath)) {
                    return nextResolve(pathToFileURL(tsPath).href, context);
                }
            }
        } catch {
            // fall through
        }
    }
    return nextResolve(specifier, context);
}

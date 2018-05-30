/**
 * @vmz/plugin — protocol helpers (no N-API).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_PROTOCOL } from '@vmz/protocol';

export { PLUGIN_PROTOCOL };

/**
 * @param {string | Buffer} content
 * @returns {string}
 */
export function contentHash(content) {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Resolve a path next to the calling module (`import.meta.url`).
 * @param {string} importMetaUrl
 * @param {string} relativePath
 */
export function pluginFileUrl(importMetaUrl, relativePath) {
    return path.join(path.dirname(fileURLToPath(importMetaUrl)), relativePath);
}

/**
 * Load a real `.vmz` (or other text) shipped beside `vmz.plugin.ts`.
 * Do not embed SFC source as JS/TS string templates.
 * @param {string} importMetaUrl `import.meta.url` of the plugin module
 * @param {string} relativePath e.g. `components/Katex.vmz`
 * @returns {{ content: string, contentHash: string, absPath: string }}
 */
export function loadPluginSource(importMetaUrl, relativePath) {
    const absPath = pluginFileUrl(importMetaUrl, relativePath);
    const content = readFileSync(absPath, 'utf8');
    return { content, contentHash: contentHash(content), absPath };
}

/**
 * @param {import('./index.js').DefinePluginInput} def
 * @returns {import('./index.js').VmzPlugin}
 */
export function definePlugin(def) {
    if (!def?.name || !def?.version || !Array.isArray(def.stages)) {
        throw new Error('definePlugin requires name, version, stages[]');
    }
    return {
        manifest: {
            name: def.name,
            version: def.version,
            protocol: def.protocol ?? PLUGIN_PROTOCOL,
            stages: def.stages,
            deterministic: def.deterministic ?? true,
        },
        contribute: def.contribute,
    };
}

/**
 * @param {import('./index.js').VmzUserConfig} config
 * @returns {import('./index.js').VmzUserConfig}
 */
export function defineConfig(config) {
    return config ?? {};
}

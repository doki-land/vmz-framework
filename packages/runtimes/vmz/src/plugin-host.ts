// @ts-nocheck
/**
 * Plugin protocol v1 helpers + typed config loading.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { PLUGIN_PROTOCOL as PLUGIN_PROTOCOL_PKG, contentHash, defineConfig, definePlugin } from '@vmz/plugin';
import { log } from './log.js';
import { resolveWorkspacePackages } from './packages.js';

export { contentHash, defineConfig, definePlugin };
export const PLUGIN_PROTOCOL = PLUGIN_PROTOCOL_PKG;

const CONFIG_NAMES = ['vmz.config.ts', 'vmz.config.mts', 'vmz.config.mjs', 'vmz.config.js'];
const ROOT_PLUGIN_NAMES = ['vmz.plugin.ts', 'vmz.plugin.mts', 'vmz.plugin.mjs', 'vmz.plugin.js'];

/**
 * @param {string} full
 * @returns {Promise<any>}
 */
export async function importMaybeTs(full) {
    const ext = path.extname(full).toLowerCase();
    if (ext === '.ts' || ext === '.mts') {
        const jiti = createJiti(import.meta.url, {
            interopDefault: true,
            moduleCache: false,
        });
        return jiti(full);
    }
    const mod = await import(pathToFileURL(full).href);
    return mod.default ?? mod;
}

/**
 * Load `vmz.config.*` from project root (+ optional root `vmz.plugin.*`).
 * @param {string} project
 * @returns {Promise<{
 *   plugins: import('@vmz/plugin').VmzPlugin[],
 *   engines: import('@vmz/plugin').VmzEngines,
 *   delivery: import('@vmz/plugin').SiteDeliveryAuthoring | null,
 *   application: { id?: string } | null,
 *   path: string | null,
 *   pluginPath: string | null,
 * }>}
 */
export async function loadVmzConfig(project) {
    /** @type {import('@vmz/plugin').VmzPlugin[]} */
    const plugins = [];
    /** @type {import('@vmz/plugin').VmzEngines} */
    let engines = {};
    /** @type {import('@vmz/plugin').SiteDeliveryAuthoring | null} */
    let delivery = null;
    /** @type {{ id?: string } | null} */
    let application = null;
    /** @type {string | null} */
    let configPath = null;
    /** @type {string | null} */
    let pluginPath = null;

    for (const name of CONFIG_NAMES) {
        const full = path.join(project, name);
        if (!existsSync(full)) continue;
        configPath = full;
        const cfg = await importMaybeTs(full);
        const raw = cfg?.plugins ?? [];
        engines = cfg?.engines && typeof cfg.engines === 'object' ? { ...cfg.engines } : {};
        if (cfg?.delivery && typeof cfg.delivery === 'object') {
            delivery = cfg.delivery;
        }
        if (cfg?.application && typeof cfg.application === 'object') {
            application = cfg.application;
        }
        for (const entry of raw) {
            plugins.push(await resolvePluginEntry(project, entry));
        }
        break;
    }

    for (const name of ROOT_PLUGIN_NAMES) {
        const full = path.join(project, name);
        if (!existsSync(full)) continue;
        pluginPath = full;
        plugins.push(await resolvePluginEntry(project, full));
        break;
    }

    return { plugins, engines, delivery, application, path: configPath, pluginPath };
}

/**
 * @param {string} project
 * @param {string | import('@vmz/plugin').VmzPlugin | Promise<import('@vmz/plugin').VmzPlugin>} entry
 */
async function resolvePluginEntry(project, entry) {
    let value = entry;
    if (typeof value === 'string') {
        const resolved = path.isAbsolute(value) ? value : path.join(project, value);
        value = await importMaybeTs(resolved);
        if (value && typeof value === 'object' && 'default' in value && value.default) {
            value = value.default;
        }
    }
    value = await value;
    if (value?.manifest && (value.contribute || value.manifest.stages)) return value;
    if (value?.name && value?.stages) return definePlugin(value);
    throw new Error(`invalid vmz plugin entry: ${String(entry)}`);
}

/**
 * Collect + apply contribution batches for the given stages onto a Workspace.
 * @param {import('../index.js').Workspace} workspace
 * @param {import('@vmz/plugin').VmzPlugin[]} plugins
 * @param {{ project: string, outDir: string, stages?: string[], engines?: import('@vmz/plugin').VmzEngines }} opts
 */
export async function applyPlugins(workspace, plugins, opts) {
    const stages = opts.stages ?? ['workspace_resolve', 'source_adapter', 'analyzer', 'target'];
    const packages = resolveWorkspacePackages(opts.project);
    const engines = opts.engines ?? {};
    /** @type {import('../index.js').ApplyContributionsReport[]} */
    const reports = [];
    /** @type {{ code: Set<string>, math: Set<string>, markdown: Set<string> }} */
    const registered = {
        code: new Set(),
        math: new Set(),
        markdown: new Set(),
    };

    for (const stage of stages) {
        for (const plugin of plugins) {
            if (!plugin.manifest.stages.includes(stage)) continue;
            if (!plugin.contribute) continue;
            const ctx = {
                project: opts.project,
                outDir: opts.outDir,
                stage,
                protocol: PLUGIN_PROTOCOL,
                packages,
                engines,
            };
            const raw = await plugin.contribute(ctx);
            const batches = Array.isArray(raw) ? raw : [raw];
            for (const batch of batches) {
                if (!batch || (batch.stage && batch.stage !== stage)) {
                    if (batch?.stage && batch.stage !== stage) continue;
                }
                for (const item of batch.items ?? []) {
                    noteEngineRegistration(registered, item);
                }
                const payload = {
                    pluginName: plugin.manifest.name,
                    pluginVersion: plugin.manifest.version,
                    protocol: plugin.manifest.protocol ?? PLUGIN_PROTOCOL,
                    stage: batch.stage ?? stage,
                    cacheKey: batch.cacheKey ?? `${plugin.manifest.name}@${plugin.manifest.version}:${stage}`,
                    deterministic: batch.deterministic ?? plugin.manifest.deterministic ?? true,
                    items: (batch.items ?? []).map(normalizeItem),
                };
                const report = workspace.applyPluginContributions(payload);
                reports.push(report);
                if (report.rejected?.length) {
                    for (const r of report.rejected) {
                        log.warn(`plugin reject ${r.plugin}::${r.itemId}: ${r.reason}`);
                    }
                } else {
                    log.info(`plugin ${plugin.manifest.name} stage=${stage} accepted=${report.accepted}`);
                }
            }
        }
    }

    if (registered.math.size || registered.code.size) {
        const facadeReports = await materializeEngineFacades(workspace, opts.project, engines, registered);
        reports.push(...facadeReports);
    }

    return reports;
}

/**
 * Only math/code/markdown register interchangeable engines (see design .
 * @param {{ code: Set<string>, math: Set<string>, markdown: Set<string> }} registered
 * @param {any} item
 */
function noteEngineRegistration(registered, item) {
    const engine = item?.engine;
    if (!engine || typeof engine !== 'string') return;
    const kind = item.engineKind ?? item.engine_kind;
    if (kind === 'math') registered.math.add(engine);
    else if (kind === 'code') registered.code.add(engine);
    else if (kind === 'markdown') registered.markdown.add(engine);
}

/**
 * Host-generated facades from registered engines + config defaults.
 * @param {import('../index.js').Workspace} workspace
 * @param {string} project
 * @param {import('@vmz/plugin').VmzEngines} engines
 * @param {{ code: Set<string>, math: Set<string>, markdown: Set<string> }} registered
 */
async function materializeEngineFacades(workspace, project, engines, registered) {
    /** @type {import('../index.js').ApplyContributionsReport[]} */
    const reports = [];
    const items = [];

    if (registered.math.size) {
        const defaultMath = pickDefault(engines.math, registered.math, 'katex');
        const content = buildMathFacade(defaultMath, [...registered.math]);
        items.push(sourceItem('facade-math', 'src/components/Math.vmz', content));
    }

    if (registered.code.size) {
        const defaultCode = pickDefault(engines.code, registered.code, 'shiki');
        const content = buildCodeFacade(defaultCode, [...registered.code]);
        items.push(sourceItem('facade-code', 'src/components/Code.vmz', content));
    }

    if (registered.markdown.size) {
        const defaultMd = pickDefault(engines.markdown, registered.markdown, 'markdown-it');
        const content = buildMarkdownFacade(defaultMd, [...registered.markdown]);
        items.push(sourceItem('facade-markdown', 'src/components/Markdown.vmz', content));
    }

    if (!items.length) return reports;

    const cacheKey = [
        'engine-facades',
        [...registered.math].sort().join(','),
        [...registered.code].sort().join(','),
        [...registered.markdown].sort().join(','),
        engines.math ?? '',
        engines.code ?? '',
        engines.markdown ?? '',
    ].join('|');

    const report = workspace.applyPluginContributions({
        pluginName: 'vmz:engine-facades',
        pluginVersion: '0.1.0',
        protocol: PLUGIN_PROTOCOL,
        stage: 'workspace_resolve',
        cacheKey,
        deterministic: true,
        items: items.map(normalizeItem),
    });
    reports.push(report);
    if (report.rejected?.length) {
        for (const r of report.rejected) {
            log.warn(`plugin reject ${r.plugin}::${r.itemId}: ${r.reason}`);
        }
    } else {
        log.info(`plugin vmz:engine-facades stage=workspace_resolve accepted=${report.accepted}`);
    }
    return reports;
}

/**
 * @param {string | undefined} configured
 * @param {Set<string>} registered
 * @param {string} preferred
 */
function pickDefault(configured, registered, preferred) {
    if (configured && registered.has(configured)) return configured;
    if (registered.has(preferred)) return preferred;
    return [...registered][0];
}

/** @param {string} id @param {string} path @param {string} content */
function sourceItem(id, path, content) {
    return {
        id,
        kind: 'source',
        path,
        content,
        contentHash: contentHash(content),
        materialize: true,
    };
}

/**
 * @param {string} defaultEngine
 * @param {string[]} engines
 */
function buildMathFacade(defaultEngine, engines) {
    const defaultLit = JSON.stringify(defaultEngine);
    const branches = engines
        .map((eng, i) => {
            const tag = engineToTag(eng);
            const kw = i === 0 ? 'if' : 'else-if';
            const engLit = JSON.stringify(eng);
            return `  <${tag} ${kw}={(engine || ${defaultLit}) === ${engLit}} tex={tex} display={display} />`;
        })
        .join('\n');
    return `<template>
${branches}
</template>

<script client>
export default class Math {
  public tex: string = '';
  public display: boolean = false;
  public engine: string | null = null;
}
</script>
`;
}

/**
 * @param {string} defaultEngine
 * @param {string[]} engines
 */
function buildCodeFacade(defaultEngine, engines) {
    const defaultLit = JSON.stringify(defaultEngine);
    const branches = engines
        .map((eng, i) => {
            const tag = engineToTag(eng);
            const kw = i === 0 ? 'if' : 'else-if';
            const engLit = JSON.stringify(eng);
            return `  <${tag} ${kw}={(engine || ${defaultLit}) === ${engLit}} code={code} lang={lang} theme={theme} />`;
        })
        .join('\n');
    return `<template>
${branches}
</template>

<script client>
export default class Code {
  public code: string = '';
  public lang: string = 'text';
  public theme: string | null = null;
  public engine: string | null = null;
}
</script>
`;
}

/**
 * @param {string} defaultEngine
 * @param {string[]} engines
 */
function buildMarkdownFacade(defaultEngine, engines) {
    const defaultLit = JSON.stringify(defaultEngine);
    const branches = engines
        .map((eng, i) => {
            const tag = engineToTag(eng);
            const kw = i === 0 ? 'if' : 'else-if';
            const engLit = JSON.stringify(eng);
            return `  <${tag} ${kw}={(engine || ${defaultLit}) === ${engLit}} source={source} />`;
        })
        .join('\n');
    return `<template>
${branches}
</template>

<script client>
export default class Markdown {
  public source: string = '';
  public engine: string | null = null;
}
</script>
`;
}

/** @param {string} engine */
function engineToTag(engine) {
    const map = {
        katex: 'Katex',
        mathjax: 'Mathjax',
        shiki: 'Shiki',
        'markdown-it': 'MarkdownIt',
    };
    if (map[engine]) return map[engine];
    return engine
        .split(/[-_]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
}

/** @param {any} item */
function normalizeItem(item) {
    return {
        id: item.id,
        kind: item.kind,
        path: item.path,
        content: item.content,
        contentHash: item.contentHash ?? item.content_hash,
        materialize: item.materialize,
        severity: item.severity,
        message: item.message,
        code: item.code,
        targetId: item.targetId ?? item.target_id,
        targetKind: item.targetKind ?? item.target_kind ?? item.type,
        manifestJson: item.manifestJson ?? item.manifest_json ?? (item.manifest != null ? JSON.stringify(item.manifest) : undefined),
        detail: item.detail,
    };
}

/** VMZ plugin protocol helpers — types + identity `define*` (no N-API). */

export { PLUGIN_PROTOCOL } from '@vmz/protocol';

export function contentHash(content: string | Buffer): string;

/** Resolve a path next to the calling module (`import.meta.url`). */
export function pluginFileUrl(importMetaUrl: string, relativePath: string): string;

/**
 * Load a real source file shipped with the plugin (typically `components/*.vmz`).
 * Do not embed `.vmz` SFC text inside `vmz.plugin.ts`.
 */
export function loadPluginSource(
    importMetaUrl: string,
    relativePath: string,
): {
    content: string;
    contentHash: string;
    absPath: string;
};

export type PluginStage = 'workspace_resolve' | 'source_adapter' | 'analyzer' | 'target';

export interface PluginManifest {
    name: string;
    version: string;
    protocol?: string;
    stages: PluginStage[];
    deterministic?: boolean;
}

export interface ResolvedPackage {
    name: string;
    root: string;
    version?: string;
}

export interface PluginContext {
    project: string;
    outDir: string;
    stage: PluginStage | string;
    protocol: string;
    packages: ResolvedPackage[];
    /** Default engines from `vmz.config`. */
    engines?: VmzEngines;
}

export interface ContributionItem {
    id: string;
    kind: string;
    path?: string;
    content?: string;
    contentHash?: string;
    content_hash?: string;
    materialize?: boolean;
    severity?: string;
    message?: string;
    code?: string;
    targetId?: string;
    target_id?: string;
    targetKind?: string;
    target_kind?: string;
    type?: string;
    manifest?: unknown;
    manifestJson?: string;
    manifest_json?: string;
    detail?: string;
    /** Engine registration (host-recognized analyzer/source sidecar). */
    engine?: string;
    engineKind?: 'code' | 'math' | 'markdown' | string;
}

export interface ContributionBatchInput {
    stage: PluginStage | string;
    cacheKey?: string;
    deterministic?: boolean;
    items: ContributionItem[];
}

export interface VmzPlugin {
    manifest: PluginManifest;
    contribute?: (
        ctx: PluginContext,
    ) => Promise<ContributionBatchInput[] | ContributionBatchInput> | ContributionBatchInput[] | ContributionBatchInput;
}

export interface VmzEngines {
    /** Default for `<Code>` when `engine` prop omitted. */
    code?: string;
    /** Default for `<Math>` when `engine` prop omitted. */
    math?: string;
    /** Default for `<Markdown>` when `engine` prop omitted; also used by `vmz document`. */
    markdown?: string;
}

export interface VmzUserConfig {
    plugins?: Array<string | VmzPlugin | Promise<VmzPlugin>>;
    engines?: VmzEngines;
    /** Application identity (optional authoring). */
    application?: { id?: string; [key: string]: unknown };
    /**
     * Site delivery (SiteDeliveryContract authoring). Pure data only.
     * Prefer `defineSite(...)` helper; never a parallel `vmz.site.ts` entry.
     */
    delivery?: SiteDeliveryAuthoring;
}

/** Authoring shape for `defineConfig({ delivery })` — normalized at build to SiteDeliveryContract. */
export interface SiteDeliveryAuthoring {
    artifact: string;
    siteId?: string;
    sources: Array<{
        id: string;
        kind: 'embedded' | 'filesystem' | 'remote';
        directory?: string;
        baseUrl?: string;
        artifact?: string;
        trust?: string;
        timeoutMs?: number;
        priority?: number;
        integrity?: unknown;
        signaturePolicy?: string;
    }>;
    resolution?: {
        mode?: 'release';
        fallback?: string[];
    };
    activation?: 'atomic';
    expectedCompatibility?: unknown;
    failure?: unknown;
    failurePolicy?: unknown;
    update?: unknown;
    updatePolicy?: unknown;
    rollback?: unknown;
    rollbackPolicy?: unknown;
    security?: unknown;
    securityPolicy?: unknown;
}

export type DefinePluginInput = PluginManifest & {
    contribute?: VmzPlugin['contribute'];
};

/** Identity helper for IDE inference. */
export function definePlugin(def: DefinePluginInput): VmzPlugin;

/** Identity helper for `vmz.config.ts` inference. */
export function defineConfig(config: VmzUserConfig): VmzUserConfig;

/**
 * Application authoring config surface — `defineConfig` + `VmzUserConfig`.
 *
 * Ownership: the application config entry belongs to the `vmz` package (CLI /
 * workspace host). `@vmz/plugin` keeps the plugin author surface (`definePlugin`,
 * protocol types). Plugin-facing types (`VmzPlugin`, `VmzEngines`) stay in
 * `@vmz/plugin` and are referenced here by type import only.
 */

import type { VmzEngines, VmzPlugin } from '@vmz/plugin';

/** Workspace format options (`vmz format` reads `vmz.config` `format`). */
export interface VmzFormatConfig {
    /** Include globs under the project root. */
    includes?: string[];
    /** Skip paths under these globs after includes expand. */
    excludes?: string[];
    /** Run `cargo fmt` when a Cargo workspace is present. */
    rust?: boolean;
    /** Run the Oak CST formatter on JS/TS targets. */
    javascript?: boolean;
    /** Format `.vmz` author files via `vmz-formatter`. */
    vmz?: boolean;
    /** Biome-style formatter config (default: `biome.json` at project root). */
    style?: string;
}

export interface VmzUserConfig {
    plugins?: Array<string | VmzPlugin | Promise<VmzPlugin>>;
    engines?: VmzEngines;
    /** Workspace format targets and engines (`vmz format`). */
    format?: VmzFormatConfig;
    /** Application identity (optional authoring). */
    application?: { id?: string; [key: string]: unknown };
    /**
     * Delivery: named profiles (`default` + `profiles`) or legacy site sugar.
     * Pure data only; never a parallel `vmz.site.ts` entry.
     */
    delivery?: DeliveryAuthoring;
}

/** Site resource sources (embedded | filesystem | remote) — orthogonal to assembly. */
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

export type DeliveryAssembly = 'local-static' | 'web-static' | 'server-host' | 'cdn+server' | 'rust-embedded';

export type DeliveryServerRuntime = 'node' | 'worker' | 'deno' | 'bun' | 'rust-host';

export interface DeliveryProfileAuthoring {
    host?: 'browser';
    assembly: DeliveryAssembly;
    /**
     * Artifact directory under CLI `--out-dir` (default = profile id).
     * Example: profile `static` + `name: 'cdn'` → `dist/cdn`.
     */
    name?: string;
    serverRuntime?: DeliveryServerRuntime;
    /** Inline site sources or `defineSite({...})`. */
    sources?: SiteDeliveryAuthoring | SiteDeliveryAuthoring['sources'];
    artifact?: string;
    resolution?: SiteDeliveryAuthoring['resolution'];
    activation?: SiteDeliveryAuthoring['activation'];
}

/** WeChat DevTools project identity. Pure data; not WeChat JSON / wx.* APIs. */
export interface WechatPackagingAuthoring {
    /** Registered AppID. Omit for WeChat tourist mode (`touristappid`). */
    appId?: string;
    projectName?: string;
    /** `app.json` `window.navigationBarTitleText`. */
    title?: string;
}

/** Vendor packaging identity under `defineConfig({ delivery })`. */
export interface DeliveryPackagingAuthoring {
    wechat?: WechatPackagingAuthoring;
}

/** Named profiles (preferred) or legacy site-only sugar. */
export type DeliveryAuthoring =
    | {
          default?: string;
          profiles: Record<string, DeliveryProfileAuthoring>;
          packaging?: DeliveryPackagingAuthoring;
      }
    | (SiteDeliveryAuthoring & {
          default?: string;
          assembly?: DeliveryAssembly;
          host?: 'browser';
          serverRuntime?: DeliveryServerRuntime;
          packaging?: DeliveryPackagingAuthoring;
      });

/** Identity helper for `vmz.config.ts` inference. */
export function defineConfig(config: VmzUserConfig): VmzUserConfig {
    return config ?? {};
}

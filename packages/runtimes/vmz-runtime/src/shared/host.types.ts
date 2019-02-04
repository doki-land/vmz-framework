/**
 * Shared host / Node runtime types for `@vmz/core`.
 */

import type { ServerResponse } from 'node:http';

export type ComponentEntry = {
    chunkId: string;
    name: string;
    entry: string;
    source?: string;
};

export type HostRequestOpts = {
    signal?: AbortSignal;
    searchParams?: URLSearchParams;
    cookieHeader?: string;
    method?: string;
    body?: unknown;
};

export type LocaleHostCtx = {
    localeId?: string;
    dir?: string;
    alternates?: unknown;
};

export type ClosedAccessResult =
    | { kind: 'allow'; props?: Record<string, unknown> }
    | { kind: 'redirect'; location: string }
    | { kind: 'deny' }
    | { kind: 'not-found' };

export type SseClient = Pick<ServerResponse, 'write' | 'end'>;

/** Deployment graph document (`vmz.deployment.v0`). */
export type DeploymentUnit = {
    chunkId?: string;
    name?: string;
    entry?: string;
    source?: string;
    dependsOn?: string[];
    [key: string]: unknown;
};

export type DeploymentLayoutChain = {
    routeId?: string;
    layouts?: string[];
    page?: string;
    [key: string]: unknown;
};

export type DeploymentDocument = {
    schema?: string;
    units?: DeploymentUnit[];
    layoutChain?: DeploymentLayoutChain[] | Record<string, unknown>;
    dependsOn?: Record<string, string[]>;
    [key: string]: unknown;
};

export type ComponentRegistryMap = Record<string, unknown>;

export type LoadComponentEntriesOpts = {
    strict?: boolean;
    closureRoots?: string[];
    explicit?: Record<string, string>;
};

export type DedupeComponentEntriesOpts = {
    strict?: boolean;
};

export type ImportComponentEntriesOpts = {
    cacheBust?: string | number;
    loaded?: Set<string>;
};

export type BootstrapComponentRegistryOpts = LoadComponentEntriesOpts &
    ImportComponentEntriesOpts & {
        preload?: 'all' | 'closure' | 'none';
    };

export type ClientComponentListEntry = {
    name: string;
    entry: string;
    chunkId?: string;
};

export type ListClientComponentsOpts = {
    strict?: boolean;
};

export type PreloadComponentRegistryOpts = ListClientComponentsOpts & {
    cacheBust?: string | number;
    include?: (entry: ClientComponentListEntry) => boolean;
    explicit?: Record<string, string>;
    closureRoots?: string[];
    preload?: 'all' | 'closure' | 'none';
};

export type NativeAddon = Record<string, unknown>;

export type ServeHostOpts = {
    distDir?: string;
    port?: number;
    host?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
};

export type SoftReloadOpts = {
    reason?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
};

export type RenderPageStreamOpts = HostRequestOpts & {
    localeId?: string;
    [key: string]: unknown;
};

export type RenderHostOpts = {
    strict?: boolean;
    closureRoots?: string[];
    explicit?: Record<string, string>;
    preload?: 'all' | 'closure' | 'none';
    cacheBust?: string | number;
    rootChunkIds?: string[] | null;
    [key: string]: unknown;
};

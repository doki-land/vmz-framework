/**
 * Types for `@vmz/core` server / RPC runtime (`faces/server.ts`).
 */

import type { IncomingMessage } from 'node:http';

export type RpcRequest = {
    moduleId: string;
    method: string;
    args?: unknown[];
};

export type Route = {
    verb: string;
    path: string;
    moduleId: string;
    method: string;
    className?: string;
};

export type PageStreamResult =
    | AsyncIterable<string>
    | {
          status?: number;
          stream?: AsyncIterable<string>;
          redirect?: string;
          headers?: Record<string, string>;
      }
    | null;

export type NodeRequestOptions = {
    distDir?: string;
    renderIndex?: () => Promise<string> | string;
    renderIndexStream?: (opts?: { signal?: AbortSignal }) => AsyncIterable<string>;
    renderPage?: (pathname: string) => Promise<string | null> | string | null;
    renderPageStream?: (
        pathname: string,
        opts?: {
            signal?: AbortSignal;
            searchParams?: URLSearchParams;
            cookieHeader?: string;
            method?: string;
            body?: unknown;
        },
    ) => Promise<PageStreamResult> | PageStreamResult;
    req?: IncomingMessage;
};

export type ServerModuleResolver = (id: string) => string | URL;

/** Subset of `node:path` used by static resolve helpers. */
export type NodePathModule = {
    resolve(...paths: string[]): string;
    join(...paths: string[]): string;
    extname(path: string): string;
    readonly sep: string;
};

/** Minimal `fs.Stats`-like surface for static file probes. */
export type StatResult = {
    isFile(): boolean;
    isDirectory(): boolean;
};

export type StatFn = (path: string) => Promise<StatResult>;

export type DistStaticResolveOpts = {
    cookieHeader?: string;
};

/** Multipart form fields: text, File, or repeated same-name values. */
export type MultipartFieldValue = string | File | Array<string | File>;

export type MultipartFields = Record<string, MultipartFieldValue>;

export type OctetStreamBody = {
    bytes: Buffer;
    size: number;
    key: string;
    uploadId: string;
    chunkIndex?: number;
    chunkTotal?: number;
    contentType: string;
};

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

/**
 * Client navigation option and helper types for `@vmz/core`.
 */

import type { ComponentCtorLike, DirectInstance } from './direct-api.types.js';

export type HydrateFn = (Ctor: ComponentCtorLike, root: Element, props: object) => Promise<unknown>;

export type HydrateRouteFn = (Page: ComponentCtorLike, root: Element, props: object, layouts?: ComponentCtorLike[]) => Promise<unknown>;

export type HydrateRoutePageFn = (Page: ComponentCtorLike, root: Element, props: object) => Promise<unknown>;

export type DomFallbackModule = {
    hydrate?: HydrateFn;
    hydrateRoute?: HydrateRouteFn;
    hydrateRoutePage?: HydrateRoutePageFn;
};

export type ClientNavOpts = {
    fetchImpl?: typeof fetch;
    document?: Document;
    history?: History;
    location?: Location;
    hydrate?: HydrateFn;
    hydrateRoute?: HydrateRouteFn;
    hydrateRoutePage?: HydrateRoutePageFn;
    destroy?: (inst: DirectInstance | object) => void;
    importPage?: (chunkId: string) => Promise<unknown>;
};

export type TransitionToOpts = {
    replace?: boolean;
    fromPop?: boolean;
    softFail?: boolean;
};

export type TransitionLocaleOpts = {
    replace?: boolean;
    softFail?: boolean;
    reload?: boolean;
    [key: string]: unknown;
};

export type TransitionToOk = {
    ok: true;
    href: string;
    chunkId: string;
    retainedLayout: boolean;
    scrollMode: string;
    focusTarget: string | null;
    localeId: string | null;
};

export type TransitionToFail = { ok: false; reason: string };

export type TransitionToResult = TransitionToOk | TransitionToFail;

export type ClientNavResult =
    | { ok: false; reason: string }
    | {
          ok: true;
          transitionTo: (url: string | URL, opts?: TransitionToOpts) => Promise<TransitionToResult>;
          transitionLocale: (toLocale: string, opts?: TransitionLocaleOpts) => Promise<unknown>;
          dispose: () => void;
          setFetch?: (impl: typeof fetch) => void;
      };

export type ScrollPosition = { x: number; y: number };

export type ScrollRestoreResult = {
    mode: string;
    x: number;
    y: number;
};

/** URL-like scroll restore target (pathname / search / hash). */
export type ScrollTarget = {
    pathname: string;
    search: string;
    hash: string;
    mode?: string;
    x?: number;
    y?: number;
};

/** In-flight SPA navigation abort handle (AbortController). */
export type InflightNav = AbortController;

export type VmzNavHost = Element & {
    __vmzInst?: DirectInstance | null;
};

export type VmzAppRoot = HTMLElement & {
    __vmzInst?: DirectInstance | null;
    __vmzPageHost?: VmzNavHost | null;
    __vmzLayoutInsts?: DirectInstance[] | null;
};

export type LocaleRouting = {
    locales?: string[];
    defaultLocale?: string;
    strategy?: string;
    defaultPrefix?: string;
    [key: string]: unknown;
};

export type LocaleHrefTable = Record<string, Record<string, string>>;

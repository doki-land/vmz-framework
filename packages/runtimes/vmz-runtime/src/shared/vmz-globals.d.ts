/** VMZ browser / host global augmentations. */
export {};

declare global {
    /** Component lazy-load hook used by browser Direct host. */
    var __vmzLoadComponent: ((name: string) => Promise<unknown> | unknown) | undefined;

    /** Leaf unknown-component diagnostics bag (SSR / client). */
    var __VMZ_COMPONENT_ERRORS__:
        | Array<{
              kind: string;
              component: string;
              via?: string;
          }>
        | undefined;

    interface GlobalThis {
        __vmzLoadComponent?: (name: string) => Promise<unknown> | unknown;
        __VMZ_COMPONENT_ERRORS__?: Array<{
            kind: string;
            component: string;
            via?: string;
        }>;
        /** Force HTTP RPC even when a local module resolver is set. */
        __VMZ_USE_HTTP_RPC?: boolean | string | number;
        /** Absolute or path-only RPC endpoint (default `/__vmz/rpc`). */
        __VMZ_RPC_PATH?: string;
        /** Origin used to absolutize relative `__VMZ_RPC_PATH` in Node. */
        __VMZ_RPC_ORIGIN?: string;
    }

    interface Window {
        __vmzBootId?: string;
        __vmzClientNavInstalled?: boolean;
        __vmzClientNavCount?: number;
        __vmzLastClientNav?: {
            url?: string;
            href?: string;
            routeId?: string | null;
            chunkId?: string;
            bootId?: string;
            retainedLayout?: boolean;
            focusTarget?: string | null;
            localeId?: string;
            scrollMode?: string;
            scrollY?: number | null;
            t?: number;
        };
        __vmzLastLocaleTransition?: Record<string, unknown>;
        __vmzLocaleIdHint?: string;
        __vmzTransitionLocale?: (to: string, opts?: Record<string, unknown>) => Promise<unknown>;
        __vmzClientNavSetFetch?: (impl: typeof fetch) => void;
        vmzDestroy?: (inst?: unknown) => void;
    }
}

declare module '/dom.browser.js' {
    export function hydrate(Ctor: unknown, root: Element, props: object): Promise<unknown>;
    export function hydrateRoute(Page: unknown, root: Element, props: object, layouts?: unknown[]): Promise<unknown>;
    export function hydrateRoutePage(Page: unknown, root: Element, props: object): Promise<unknown>;
}

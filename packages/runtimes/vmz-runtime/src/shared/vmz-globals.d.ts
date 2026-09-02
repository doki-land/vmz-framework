/** VMZ browser / host global augmentations. */
export {};

declare global {
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
}

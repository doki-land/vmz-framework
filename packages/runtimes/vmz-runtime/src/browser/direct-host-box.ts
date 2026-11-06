/**
 * Direct host box model (`ui-direct-host-box`).
 * Chip hosts opt into `display: contents`; block surfaces keep a real layout box.
 */

import type { ComponentCtor } from './dom-core.types.js';

export const INLINE_HOST_CONTENTS: ReadonlySet<string> = new Set(['Button', 'Badge', 'Link', 'Tag', 'Icon']);

export function resolveDirectHostBox(name: string, Ctor: ComponentCtor | null | undefined): 'contents' | 'block' {
    const explicit = Ctor && typeof Ctor.__vmzHostBox === 'string' ? Ctor.__vmzHostBox : null;
    if (explicit === 'contents' || explicit === 'block') return explicit;
    if (INLINE_HOST_CONTENTS.has(String(name || ''))) return 'contents';
    return 'block';
}

/** Apply host box to a live DOM element (create / hydrate / resume). */
export function applyDirectHostBox(host: HTMLElement, name: string, Ctor: ComponentCtor | null | undefined): void {
    if (!host || !host.style) return;
    if (resolveDirectHostBox(name, Ctor) === 'contents') {
        host.style.display = 'contents';
    }
}

/** SSR attrs fragment for host box (only when contents). */
export function directHostBoxStyleAttr(name: string, Ctor: ComponentCtor | null | undefined): string | null {
    return resolveDirectHostBox(name, Ctor) === 'contents' ? 'display:contents' : null;
}

/**
 * Host element tag (`div` vs `span`).
 *
 * `display: contents` chips are phrasing content, so a `<div>` host is invalid
 * HTML inside `<p>`. The browser parser then closes the `<p>` early and moves
 * the host (and its trailing text) out of it, which desynchronizes the SSR tree
 * from the client tree and makes resume rebuild those nodes. Emitting a `<span>`
 * host keeps the SSR markup parse-stable: the parsed tree matches the tree the
 * client `__vmzCreate` builds.
 */
export function resolveDirectHostTag(name: string, Ctor: ComponentCtor | null | undefined): 'div' | 'span' {
    return resolveDirectHostBox(name, Ctor) === 'contents' ? 'span' : 'div';
}

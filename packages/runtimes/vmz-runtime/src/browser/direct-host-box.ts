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

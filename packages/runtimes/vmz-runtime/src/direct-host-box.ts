/**
 * Direct host box model (`ui-direct-host-box`).
 * Chip hosts opt into `display: contents`; block surfaces keep a real layout box.
 */

/** @type {ReadonlySet<string>} */
export const INLINE_HOST_CONTENTS = new Set(['Button', 'Badge', 'Link', 'Tag', 'Icon']);

/**
 * @param {string} name
 * @param {{ __vmzHostBox?: string } | null | undefined} Ctor
 * @returns {'contents' | 'block'}
 */
export function resolveDirectHostBox(name, Ctor) {
    const explicit = Ctor && typeof Ctor.__vmzHostBox === 'string' ? Ctor.__vmzHostBox : null;
    if (explicit === 'contents' || explicit === 'block') return explicit;
    if (INLINE_HOST_CONTENTS.has(String(name || ''))) return 'contents';
    return 'block';
}

/**
 * Apply host box to a live DOM element (create / hydrate / resume).
 * @param {HTMLElement} host
 * @param {string} name
 * @param {{ __vmzHostBox?: string } | null | undefined} Ctor
 */
export function applyDirectHostBox(host, name, Ctor) {
    if (!host || !host.style) return;
    if (resolveDirectHostBox(name, Ctor) === 'contents') {
        host.style.display = 'contents';
    }
}

/**
 * SSR attrs fragment for host box (only when contents).
 * @param {string} name
 * @param {{ __vmzHostBox?: string } | null | undefined} Ctor
 * @returns {string | null}
 */
export function directHostBoxStyleAttr(name, Ctor) {
    return resolveDirectHostBox(name, Ctor) === 'contents' ? 'display:contents' : null;
}

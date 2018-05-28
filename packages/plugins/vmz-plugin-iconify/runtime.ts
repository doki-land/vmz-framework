/**
 * Iconify SVG fetch helper (runtime). Prefer build-time offline collections later.
 */

const cache = new Map<string, string>();

/** `name` is icon set:name e.g. `mdi:home`. */
export async function loadIconSvg(name: string): Promise<string> {
    const key = String(name ?? '');
    if (cache.has(key)) return cache.get(key)!;
    const [prefix, icon] = key.split(':');
    if (!prefix || !icon) {
        const empty = '';
        cache.set(key, empty);
        return empty;
    }
    try {
        const res = await fetch(`https://api.iconify.design/${prefix}/${icon}.svg`);
        if (!res.ok) throw new Error(String(res.status));
        const svg = await res.text();
        cache.set(key, svg);
        return svg;
    } catch {
        const empty = '';
        cache.set(key, empty);
        return empty;
    }
}

export function iconFallback(name: string): string {
    const escaped = String(name ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<span class="iconify-fallback" data-icon="${escaped}"></span>`;
}

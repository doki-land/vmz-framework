/**
 * Content identity for `v-html` payloads shared by SSR and resume.
 *
 * The browser serializer expands self-closing tags (`<path/>` becomes
 * `<path></path>`), so comparing a generated markup string with the serialized
 * SSR DOM always misses. SSR therefore records the digest of the exact string
 * it wrote, and resume compares that marker with the digest of the string it
 * would write. The digest is taken over the generated string only: no DOM
 * serialization, no normalization.
 *
 * Two independent 32-bit FNV-1a lanes plus the code-unit length give 64 bits of
 * identity without pulling a crypto dependency into the browser bundle.
 */
export const HTML_HASH_ATTR = 'data-vmz-html-hash';

export function htmlDigest(value: string): string {
    const text = value == null ? '' : String(value);
    let laneA = 0x811c9dc5;
    let laneB = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        laneA = Math.imul(laneA ^ code, 0x01000193) >>> 0;
        laneB = Math.imul(laneB ^ code, 0x85ebca77) >>> 0;
    }
    return `${text.length.toString(36)}-${laneA.toString(36)}-${laneB.toString(36)}`;
}

/**
 * Example third-party replaceable highlighter plugin shape.
 *
 * Real syntect would live in a Rust N-API / wasm host; this JS package only
 * documents registration: factory → createPlainHighlighter → registerHighlighter.
 * Compiler core must NOT hard-depend on syntect/comrak/shiki filenames.
 */

import { createPlainHighlighter, registerHighlighter, type Highlighter } from '@vmz/highlighter';

export type SyntectPluginOptions = {
    /** Display id for the registered highlighter (default `syntect`). */
    id?: string;
};

/**
 * Factory used by replaceable-content-plugin gate as the third-party shape.
 * Registers a plain highlighter under a syntect-flavored id.
 */
export function syntect(options: SyntectPluginOptions = {}): Highlighter {
    const highlighter = createPlainHighlighter(options.id ?? 'syntect');
    registerHighlighter(highlighter);
    return highlighter;
}

export { registerHighlighter, createPlainHighlighter };

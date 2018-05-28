import grammar from '../grammars/vmz.tmLanguage.json' with { type: 'json' };

/** TextMate grammar object (VS Code `contributes.grammars` / raw consumers). */
export const vmzGrammar = grammar;

/** Language id used by VS Code and Shiki (`lang: 'vmz'`). */
export const vmzLanguageId = 'vmz' as const;

/** TextMate scope name. */
export const vmzScopeName = 'source.vmz' as const;

/** Bundled langs Shiki must load alongside `vmzLanguage` for embeds. */
export const vmzEmbeddedLangs = ['typescript', 'css', 'html'] as const;

/**
 * Shiki `LanguageRegistration` — same grammar VS Code loads.
 *
 * Prefer {@link createVmzHighlighter} on the homepage so embeds stay in sync.
 */
export const vmzLanguage = {
    ...vmzGrammar,
    name: vmzLanguageId,
    scopeName: vmzScopeName,
    aliases: ['.vmz'],
    embeddedLangs: [...vmzEmbeddedLangs],
};

export type CreateVmzHighlighterOptions = {
    /** Extra Shiki theme ids (default: `vitesse-dark`). */
    themes?: string[];
    /** Extra language ids / registrations beyond VMZ embeds. */
    langs?: unknown[];
};

/**
 * Homepage / docs helper: create a Shiki highlighter preloaded with `vmz` + embeds.
 *
 * Requires peer `shiki` (not bundled here).
 *
 * @example
 * ```ts
 * import { createVmzHighlighter } from 'vmz-textmate/shiki'
 * const hi = await createVmzHighlighter({ themes: ['vitesse-light'] })
 * hi.codeToHtml(src, { lang: 'vmz', theme: 'vitesse-light' })
 * ```
 */
export async function createVmzHighlighter(options: CreateVmzHighlighterOptions = {}) {
    const { createHighlighter } = await import('shiki');
    const themes = options.themes?.length ? options.themes : ['vitesse-dark'];
    return createHighlighter({
        langs: [vmzLanguage, ...vmzEmbeddedLangs, ...(options.langs ?? [])],
        themes,
    });
}

export default vmzLanguage;

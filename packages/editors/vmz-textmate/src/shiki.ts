import grammar from '../grammars/vmz.tmLanguage.json' with { type: 'json' };
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import html from '@shikijs/langs/html';
import css from '@shikijs/langs/css';
import typescript from '@shikijs/langs/typescript';
import vitesseDark from '@shikijs/themes/vitesse-dark';

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
    const themes = options.themes?.length ? options.themes : ['vitesse-dark'];
    if (themes.some((theme) => theme !== 'vitesse-dark')) {
        throw new Error('vmz-textmate: unsupported theme');
    }
    return createHighlighterCore({
        langs: [vmzLanguage, html, css, typescript, ...(options.langs ?? [])] as any,
        themes: [vitesseDark],
        engine: createJavaScriptRegexEngine(),
    });
}

export default vmzLanguage;

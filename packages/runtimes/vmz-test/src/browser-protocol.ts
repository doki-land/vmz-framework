/**
 * Browser Host U0 protocol — Locator / Action / Expectation shapes.
 *
 * Owns VMZ locator semantics. CDP/puppeteer-core is transport only.
 * Legacy `selector` strings lower to `{ kind: 'css' }` with a warning (escape hatch).
 */

export const BROWSER_LOCATOR_KINDS = Object.freeze(['role', 'label', 'text', 'testId', 'css'] as const);

export type BrowserLocator =
    | { kind: 'role'; role: string; name?: string; exact?: boolean }
    | { kind: 'label'; text: string; exact?: boolean }
    | { kind: 'text'; text: string; exact?: boolean }
    | { kind: 'testId'; testId: string }
    | { kind: 'css'; selector: string };

export type BrowserActionOptions = {
    timeoutMs?: number;
    force?: boolean;
};

export type LocatorResolveResult = {
    ok: boolean;
    count: number;
    actionable: boolean;
    reason: string;
    index: number;
    tag?: string;
    name?: string;
};

/**
 * Parse locator from a browser action object.
 * Prefers `locator`; falls back to legacy `selector` → css (warning).
 */
export function parseActionLocator(action: Record<string, unknown>): {
    locator: BrowserLocator | null;
    warnings: string[];
} {
    const warnings: string[] = [];
    const loc =
        action && typeof action.locator === 'object' && action.locator
            ? (action.locator as Record<string, unknown>)
            : null;
    if (loc) {
        const kind = String(loc.kind || '');
        if (kind === 'role') {
            const role = String(loc.role || '').trim();
            if (!role) return { locator: null, warnings: ['locator.role required'] };
            return {
                locator: {
                    kind: 'role',
                    role,
                    name: loc.name != null ? String(loc.name) : undefined,
                    exact: loc.exact === true,
                },
                warnings,
            };
        }
        if (kind === 'label') {
            const text = String(loc.text || '').trim();
            if (!text) return { locator: null, warnings: ['locator.text required for label'] };
            return { locator: { kind: 'label', text, exact: loc.exact === true }, warnings };
        }
        if (kind === 'text') {
            const text = String(loc.text || '').trim();
            if (!text) return { locator: null, warnings: ['locator.text required'] };
            return { locator: { kind: 'text', text, exact: loc.exact === true }, warnings };
        }
        if (kind === 'testId') {
            const testId = String(loc.testId || loc.value || '').trim();
            if (!testId) return { locator: null, warnings: ['locator.testId required'] };
            return { locator: { kind: 'testId', testId }, warnings };
        }
        if (kind === 'css') {
            const selector = String(loc.selector || '').trim();
            if (!selector) return { locator: null, warnings: ['locator.selector required for css'] };
            warnings.push('locator.kind=css is an escape hatch; prefer role/label/text/testId');
            return { locator: { kind: 'css', selector }, warnings };
        }
        return { locator: null, warnings: [`unknown locator.kind ${JSON.stringify(kind)}`] };
    }

    if (typeof action.selector === 'string' && action.selector.trim()) {
        warnings.push('action.selector is legacy css escape hatch; prefer action.locator');
        return { locator: { kind: 'css', selector: action.selector.trim() }, warnings };
    }

    return { locator: null, warnings };
}

/** Default click target when neither locator nor selector is set (Direct mount harness). */
export function defaultClickLocator(): BrowserLocator {
    return { kind: 'role', role: 'button' };
}

/**
 * In-page locator resolver (serializable for page.evaluate).
 * Returns match metadata; host waits until unique + actionable.
 */
export function resolveLocatorInPage(
    locator: BrowserLocator,
    opts: BrowserActionOptions = {},
): LocatorResolveResult {
    const root = document.getElementById('app') || document.body;
    if (!root) return { ok: false, count: 0, actionable: false, reason: '#app missing', index: -1 };

    const normalize = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: Element) => {
        const labelled = el.getAttribute('aria-label');
        if (labelled) return normalize(labelled);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const id = el.id;
            if (id) {
                const lab = root.querySelector(`label[for="${CSS.escape(id)}"]`);
                if (lab) return normalize(lab.textContent || '');
            }
        }
        return normalize((el as HTMLElement).innerText || el.textContent || '');
    };
    const isVisible = (el: Element) => {
        if (!(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const isEnabled = (el: Element) => {
        if (
            el instanceof HTMLButtonElement ||
            el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement ||
            el instanceof HTMLTextAreaElement
        ) {
            if (el.disabled) return false;
            if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) return false;
            return true;
        }
        return el.getAttribute('aria-disabled') !== 'true';
    };

    let found: Element[] = [];

    if (locator.kind === 'css') {
        try {
            found = [...root.querySelectorAll(String(locator.selector || ''))];
        } catch (e) {
            return {
                ok: false,
                count: 0,
                actionable: false,
                reason: `bad css: ${e instanceof Error ? e.message : e}`,
                index: -1,
            };
        }
    } else if (locator.kind === 'testId') {
        const id = String(locator.testId || '');
        found = [...root.querySelectorAll(`[data-testid="${CSS.escape(id)}"]`)];
    } else if (locator.kind === 'role') {
        const role = String(locator.role || '');
        let pool: Element[] = [];
        if (role === 'button') {
            pool = [...root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')];
        } else if (role === 'textbox') {
            pool = [
                ...root.querySelectorAll(
                    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [role="textbox"]',
                ),
            ];
        } else if (role === 'link') {
            pool = [...root.querySelectorAll('a[href], [role="link"]')];
        } else if (role === 'checkbox') {
            pool = [...root.querySelectorAll('input[type="checkbox"], [role="checkbox"]')];
        } else if (role === 'combobox') {
            pool = [...root.querySelectorAll('select, [role="combobox"]')];
        } else if (role === 'listbox') {
            pool = [...root.querySelectorAll('select, [role="listbox"]')];
        } else if (role === 'option') {
            pool = [...root.querySelectorAll('option, [role="option"], [data-vmz-option]')];
        } else {
            pool = [...root.querySelectorAll(`[role="${CSS.escape(role)}"]`)];
        }
        if (locator.name != null && String(locator.name).length) {
            const want = normalize(locator.name);
            found = pool.filter((el) => {
                const n = nameOf(el);
                const optVal = el.getAttribute('data-vmz-option') || (el instanceof HTMLOptionElement ? el.value : '');
                return locator.exact
                    ? n === want || optVal === want
                    : n.includes(want) || String(optVal).includes(want);
            });
        } else {
            found = pool;
        }
    } else if (locator.kind === 'label') {
        const want = normalize(locator.text);
        const labels = [...root.querySelectorAll('label')].filter((lab) => {
            const t = normalize(lab.textContent || '');
            return locator.exact ? t === want : t.includes(want);
        });
        found = labels
            .map((lab) => {
                if (lab instanceof HTMLLabelElement && lab.control) return lab.control;
                const htmlFor = lab.getAttribute('for');
                if (htmlFor) return root.querySelector(`#${CSS.escape(htmlFor)}`);
                return lab.querySelector('input, textarea, select');
            })
            .filter((el): el is Element => Boolean(el));
    } else if (locator.kind === 'text') {
        const want = normalize(locator.text);
        const all = [...root.querySelectorAll('button, a, label, p, span, li, td, th, h1, h2, h3, h4, h5, h6, [role]')];
        found = all.filter((el) => {
            const t = normalize((el as HTMLElement).innerText || el.textContent || '');
            if (!t) return false;
            return locator.exact ? t === want : t.includes(want);
        });
    } else {
        return {
            ok: false,
            count: 0,
            actionable: false,
            reason: `unknown locator.kind ${(locator as { kind?: string }).kind}`,
            index: -1,
        };
    }

    const visible = found.filter(isVisible);
    const actionable = opts.force ? visible : visible.filter(isEnabled);
    if (actionable.length === 1) {
        for (const el of root.querySelectorAll('[data-vmz-bh-target]')) el.removeAttribute('data-vmz-bh-target');
        const target = actionable[0];
        target.setAttribute('data-vmz-bh-target', '1');
        return {
            ok: true,
            count: 1,
            actionable: true,
            reason: '',
            index: 0,
            tag: target.tagName.toLowerCase(),
            name: nameOf(target),
        };
    }
    if (actionable.length === 0) {
        return {
            ok: false,
            count: found.length,
            actionable: false,
            reason: found.length === 0 ? 'no matches' : visible.length === 0 ? 'matches not visible' : 'matches not actionable',
            index: -1,
        };
    }
    return {
        ok: false,
        count: actionable.length,
        actionable: false,
        reason: `ambiguous: ${actionable.length} actionable matches`,
        index: -1,
    };
}

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

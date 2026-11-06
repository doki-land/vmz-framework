/**
 * Custom Element `vmz-highlighter` — highlight textContent via getHighlighter().
 * Usable outside VMZ (no CodeBlock / runtime required).
 */

import { getHighlighter } from './index.js';

const TAG = 'vmz-highlighter';

export class VmzHighlighterElement extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['language', 'theme'];
    }

    #shadow: ShadowRoot;
    #pre: HTMLPreElement;
    #pending = false;
    #observer: MutationObserver;
    #renderVersion = 0;

    constructor() {
        super();
        this.#shadow = this.attachShadow({ mode: 'open' });
        this.#pre = document.createElement('pre');
        this.#pre.setAttribute('part', 'code');
        this.#shadow.appendChild(this.#pre);
        // The code input is light-DOM text: consumers update it as a property,
        // which never reaches `attributeChangedCallback`.
        this.#observer = new MutationObserver(() => this.#schedule());
    }

    get language(): string | null {
        return this.getAttribute('language');
    }

    set language(value: string | null) {
        this.#reflect('language', value);
    }

    get theme(): string | null {
        return this.getAttribute('theme');
    }

    set theme(value: string | null) {
        this.#reflect('theme', value);
    }

    #reflect(name: string, value: string | null): void {
        if (value == null) this.removeAttribute(name);
        else this.setAttribute(name, String(value));
    }

    connectedCallback(): void {
        this.#observer.observe(this, { childList: true, characterData: true, subtree: true });
        this.#schedule();
    }

    disconnectedCallback(): void {
        this.#observer.disconnect();
    }

    attributeChangedCallback(): void {
        this.#schedule();
    }

    #schedule(): void {
        if (this.#pending) return;
        this.#pending = true;
        queueMicrotask(() => {
            this.#pending = false;
            void this.#render();
        });
    }

    async #render(): Promise<void> {
        const version = ++this.#renderVersion;
        const code = this.textContent ?? '';
        const language = this.getAttribute('language') ?? undefined;
        const theme = this.getAttribute('theme') ?? undefined;
        const result = await getHighlighter().highlight(code, { language, theme });
        // Rapid property writes can resolve out of order: keep only the newest.
        if (version !== this.#renderVersion) return;
        // Prefer injecting the engine HTML into the shadow pre host.
        this.#pre.innerHTML = result.html;
    }
}

export function defineVmzHighlighter(): void {
    if (typeof customElements === 'undefined') return;
    if (!customElements.get(TAG)) {
        customElements.define(TAG, VmzHighlighterElement);
    }
}

defineVmzHighlighter();

export { TAG as VMZ_HIGHLIGHTER_TAG };

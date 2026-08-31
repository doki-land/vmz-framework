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

    constructor() {
        super();
        this.#shadow = this.attachShadow({ mode: 'open' });
        this.#pre = document.createElement('pre');
        this.#pre.setAttribute('part', 'code');
        this.#shadow.appendChild(this.#pre);
    }

    connectedCallback(): void {
        this.#schedule();
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
        const code = this.textContent ?? '';
        const language = this.getAttribute('language') ?? undefined;
        const theme = this.getAttribute('theme') ?? undefined;
        const result = await getHighlighter().highlight(code, { language, theme });
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

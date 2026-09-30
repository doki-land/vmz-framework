import { applyDirectHostBox, directHostBoxStyleAttr } from '../browser/direct-host-box.js';
import {
    applyDomAttr,
    applyPreservedState,
    BOOLEAN_HTML_ATTRS,
    createInstance,
    destroy,
    directApi,
    eventPropHandlerName,
    findOwnedDefaultSlot,
    getRegisteredComponent,
    hasMeaningfulChild,
    isEventEntryStrategy,
    mergeClassParts,
    mergeStyleParts,
    mount,
    noteDomCreate,
    resolveComponent,
    runDirectCreate,
    scheduleClientOn,
    settlePendingChildMounts,
    snapshotInstanceState,
    stripFns,
} from '../browser/dom-core.js';
import { createUnknownComponentElement, markUnknownComponentHost, serializeUnknownComponentNode } from '../browser/unknown-component.js';

export let _ssrDocumentLastError = null;

export function ensureSsrDocument() {
    if (typeof globalThis.document !== 'undefined' && typeof globalThis.document.createElement === 'function') {
        return true;
    }
    const proc = globalThis.process;
    if (!proc?.versions?.node) {
        _ssrDocumentLastError = new Error('vmz:dom SSR document: not running on Node');
        return false;
    }
    try {
        // Node 20.16+ / 22.3+: sync builtin load without a static `node:` import.
        const mod = typeof proc.getBuiltinModule === 'function' ? proc.getBuiltinModule('module') : null;
        if (!mod?.createRequire) {
            _ssrDocumentLastError = new Error('vmz:dom SSR document: createRequire unavailable');
            return false;
        }
        const pathMod = typeof proc.getBuiltinModule === 'function' ? proc.getBuiltinModule('path') : null;
        const createRequire = mod.createRequire;

        const bases = [];
        bases.push(import.meta.url);
        if (pathMod && typeof proc.cwd === 'function') {
            bases.push(pathMod.join(proc.cwd(), 'package.json'));
        }

        const errors = [];
        let parseHTML = null;
        for (const base of bases) {
            let req;
            try {
                req = createRequire(base);
            } catch (e) {
                errors.push(`${base}: createRequire failed: ${e && e.message ? e.message : e}`);
                continue;
            }
            try {
                parseHTML = req('linkedom').parseHTML;
                break;
            } catch (e) {
                errors.push(`${base} ??linkedom: ${e && e.message ? e.message : e}`);
            }
            // Walk into @vmz/core's dependency tree (linkedom is declared there).
            for (const coreId of ['@vmz/core', '@vmz/core/dom', '@vmz/core/server']) {
                try {
                    const coreEntry = req.resolve(coreId);
                    parseHTML = createRequire(coreEntry)('linkedom').parseHTML;
                    break;
                } catch (e) {
                    errors.push(`${base} ??${coreId}/linkedom: ${e && e.message ? e.message : e}`);
                }
            }
            if (parseHTML) break;
        }
        if (typeof parseHTML !== 'function') {
            const detail = errors.length ? `\n${errors.join('\n')}` : '';
            throw new Error(`linkedom unresolved for SSR document${detail}`);
        }
        const { window, document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
        globalThis.window = window;
        globalThis.document = document;
        _ssrDocumentLastError = null;
        return typeof document.createElement === 'function';
    } catch (err) {
        _ssrDocumentLastError = err instanceof Error ? err : new Error(String(err));
        return false;
    }
}

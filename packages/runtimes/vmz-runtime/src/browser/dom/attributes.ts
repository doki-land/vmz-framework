import { mergeClassParts, mergeStyleParts } from '../../shared/dom-attr-normalize.js';
import type { BindingId, DirectInstance, PatchFn } from '../direct-api.types.js';
import { applyDirectHostBox } from '../direct-host-box.js';
import type {
    ComponentCtor,
    EachCtx,
    PrecisionState,
    ReactiveEntry,
    ResumeAdoptCtx,
    TraceBuffer,
    VmzContainer,
    VmzDomElement,
    VmzDomNode,
} from '../dom-core.types.js';
import { createUnknownComponentElement } from '../unknown-component.js';

/**
 * `xlink:href` parsed from SSR HTML lives in the XLink namespace. A plain
 * `setAttribute` writes a non-namespaced attribute instead, so the SVG host
 * (`<use>`) no longer resolves the reference after hydration or client create.
 */
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export const BOOLEAN_HTML_ATTRS = new Set([
    'disabled',
    'checked',
    'selected',
    'readonly',
    'required',
    'multiple',
    'hidden',
    'autofocus',
    'autoplay',
    'controls',
    'loop',
    'muted',
    'open',
    'novalidate',
    'formnovalidate',
    'defer',
    'async',
    'ismap',
    'default',
    'inert',
]);

/**
 * A `<select>` is patched before its `<option>` children are appended: emit
 * writes the model attr while the select is still empty, so the first write
 * selects nothing and the model never changes again. Remember the pending
 * value and replay it once the synchronous create pass has finished.
 */
const pendingSelectValues = new WeakMap<object, unknown>();
const pendingSelectReplays = new WeakSet<object>();

function replaySelectValue(el) {
    if (!pendingSelectValues.has(el)) return;
    const value = pendingSelectValues.get(el);
    const opts = el.options || el.querySelectorAll?.('option') || [];
    if (!opts.length) return;
    pendingSelectValues.delete(el);
    applyDomAttr(el, 'value', value);
}

function deferSelectValue(el) {
    if (pendingSelectReplays.has(el)) return;
    pendingSelectReplays.add(el);
    queueMicrotask(() => {
        pendingSelectReplays.delete(el);
        replaySelectValue(el);
    });
}

export function applyDomAttr(el, name, value) {
    const key = name === 'className' ? 'class' : name;
    if (key === 'class') {
        const s = mergeClassParts(value);
        if (s) el.setAttribute('class', s);
        else el.removeAttribute('class');
        return;
    }
    if (key === 'style') {
        const s = mergeStyleParts(value);
        if (s) el.setAttribute('style', s);
        else el.removeAttribute('style');
        return;
    }
    if (String(key).startsWith('xlink:') && el && typeof el.setAttributeNS === 'function') {
        const local = String(key).slice('xlink:'.length);
        if (value == null || value === false) {
            if (typeof el.removeAttributeNS === 'function') el.removeAttributeNS(XLINK_NS, local);
            else el.removeAttribute(key);
        } else {
            el.setAttributeNS(XLINK_NS, `xlink:${local}`, value === true ? '' : String(value));
        }
        return;
    }
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        const on = value === true || value === '';
        // Reflect `checked` through its IDL property. Once the user has interacted
        // with a radio, attribute writes only reach its default state, so a later
        // model update would otherwise leave the visible control stale.
        if (key === 'checked' && el && el.tagName === 'INPUT') {
            if (el.checked !== on) el.checked = on;
        }
        if (value === false || value == null || value === '') {
            el.removeAttribute(key);
        } else {
            el.setAttribute(key, value === true ? '' : String(value));
        }
        return;
    }
    // <textarea value="??> as an attribute does not update visible text; INPUT/SELECT
    // also need the IDL `.value` property so controlled updates stay in sync after switches.
    // linkedom `<select>.value` is getter-only ??sync via `option.selected` instead of throwing.
    if (key === 'value' && el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
        // A `multiple` select model is a list: every option in the model is
        // selected and there is no single `value` attribute to reflect.
        const listed = Array.isArray(value) ? value.map((v) => String(v)) : null;
        const next = value == null || value === false ? '' : String(value);
        if (el.tagName === 'SELECT') {
            const opts = el.options || el.querySelectorAll?.('option') || [];
            if (!opts.length) {
                pendingSelectValues.set(el, value);
                deferSelectValue(el);
                return;
            }
            pendingSelectValues.delete(el);
            for (const opt of opts) {
                // Match SSR `markSelectSelection`: an option without a `value`
                // attribute contributes its trimmed text. Reading IDL `.value`
                // here keeps the template's indentation and loses the selection
                // right after hydration.
                const optionValue =
                    typeof opt.hasAttribute === 'function' && opt.hasAttribute('value')
                        ? String(opt.getAttribute('value') ?? '')
                        : String(opt.textContent ?? opt.value ?? '').trim();
                opt.selected = listed ? listed.includes(optionValue) : optionValue === next;
            }
        } else if (el.value !== next) {
            el.value = next;
        }
        if (listed) return;
        if (value == null || value === false) el.removeAttribute('value');
        else el.setAttribute('value', next);
        return;
    }
    if (value == null || value === false) el.removeAttribute(key);
    else el.setAttribute(key, value === true ? '' : String(value));
}

export function eventPropHandlerName(name) {
    if (typeof name !== 'string' || !name) return null;
    if (/^on[A-Z]/.test(name)) return name;
    return null;
}

export function emitComponentEvent(inst, eventName, ...payload) {
    if (!inst || typeof eventName !== 'string' || !eventName) return;
    const bag = inst.__vmzComponentListeners;
    const list = bag && bag[eventName];
    if (!Array.isArray(list) || list.length === 0) return;
    for (const fn of list) {
        if (typeof fn === 'function') fn(...payload);
    }
}

export function isEventPropName(name) {
    return eventPropHandlerName(name) != null;
}

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

export const components: Record<string, ComponentCtor> = Object.create(null);

export function registerComponents(map) {
    Object.assign(components, map);
}

export function getRegisteredComponent(name) {
    return components[name] || null;
}

export async function resolveComponent(name) {
    let Ctor = components[name];
    if (!Ctor && typeof globalThis.__vmzLoadComponent === 'function') {
        Ctor = (await globalThis.__vmzLoadComponent(name)) as ComponentCtor | null | undefined;
        if (Ctor) registerComponents({ [name]: Ctor });
    }
    return Ctor || null;
}

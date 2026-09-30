/** Browser DOM runtime barrel. */
export { mergeClassParts, mergeStyleParts } from '../shared/dom-attr-normalize.js';
export { applyDirectHostBox, INLINE_HOST_CONTENTS, resolveDirectHostBox } from './direct-host-box.js';
export {
    createUnknownComponentElement,
    markUnknownComponentHost,
    serializeUnknownComponentNode,
    UNKNOWN_COMPONENT_ERROR,
} from './unknown-component.js';
export { __vmzPrecisionEnable } from './diagnostics/precision-trace.js';
export { __vmzTraceEnable } from './diagnostics/precision-trace.js';
export { __vmzPrecisionReset } from './diagnostics/precision-trace.js';
export { __vmzTraceReset } from './diagnostics/precision-trace.js';
export { __vmzTraceSnapshot } from './diagnostics/precision-trace.js';
export { __vmzPrecisionSnapshot } from './diagnostics/precision-trace.js';
export { registerComponents } from './dom/registry.js';
export { getRegisteredComponent } from './dom/registry.js';
export { resolveComponent } from './dom/registry.js';
export { mount } from './dom/component.js';
export { settlePendingChildMounts } from './dom/component.js';
export { runDirectCreate } from './dom/component.js';
export { findOwnedDefaultSlot } from './dom/component.js';
export { findOwnedDefaultSlotTarget } from './dom/component.js';
export { createInstance } from './dom/component.js';
export { destroy } from './dom/component.js';
export { disposeDomTree } from './dom/component.js';
export { snapshotInstanceState } from './dom/component.js';
export { applyPreservedState } from './dom/component.js';
export { stripFns } from './dom/component.js';
export { BOOLEAN_HTML_ATTRS } from './dom/attributes.js';
export { applyDomAttr } from './dom/attributes.js';
export { eventPropHandlerName } from './dom/attributes.js';
export { emitComponentEvent } from './dom/attributes.js';
export { isEventPropName } from './dom/attributes.js';
export { noteDomCreate } from './dom/lifecycle.js';
export { scheduleClient } from './dom/lifecycle.js';
export { isEventEntryStrategy } from './dom/lifecycle.js';
export { scheduleClientOn } from './dom/lifecycle.js';
export { __vmzRunTask } from './dom/lifecycle.js';
export { __vmzCancelTasks } from './dom/lifecycle.js';
export { __vmzTaskStatus } from './dom/lifecycle.js';
export { directApi } from './dom/direct-api.js';
export { __vmzAllowShared } from './reactivity/write-barrier.js';
export { __vmzTakeShared } from './reactivity/write-barrier.js';
export { __vmzSharedCrossComponentDiagnostics } from './reactivity/write-barrier.js';
export { __vmzSharedCrossComponentDiagnosticsReset } from './reactivity/write-barrier.js';
export { __vmzReadPath } from './reactivity/write-barrier.js';
export { __vmzWritePathLogical } from './reactivity/write-barrier.js';
export { __vmzWritePath } from './reactivity/write-barrier.js';
export { __vmzWritePathItem } from './reactivity/write-barrier.js';
export { __vmzListTranspose } from './reactivity/write-barrier.js';
export { __vmzWritePathCompound } from './reactivity/write-barrier.js';
export { __vmzWritePathCompoundItem } from './reactivity/write-barrier.js';
export { __vmzArrayItemCompoundStride } from './reactivity/write-barrier.js';
export { __vmzArrayMutate } from './reactivity/write-barrier.js';
export { __vmzIsWriteBarrierOwned } from './reactivity/write-barrier.js';
export { __vmzIsReactiveProxy } from './reactivity/write-barrier.js';
export { flushPending } from './reactivity/patch-scheduler.js';
export { hasMeaningfulChild } from './reactivity/patch-scheduler.js';

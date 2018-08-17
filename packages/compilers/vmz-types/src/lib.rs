//! VMZ-specific types on top of the oxc toolchain.
//!
//! Spans, source ids, diagnostics, AST, and parsing come from oxc.
//! This crate only models `.vmz` component conventions that oxc does not own.
//! Versioned wire protocols live in `vmz-protocol`.
//!
//! Wire conventions (pick the smallest form that fits):
//!
//! 1. **Open label** — plain `String` when the set is intentionally open
//!    (host plugins, catalogs, unknown-kind scanners / negative tests).
//! 2. **Closed unit enum** — only when the value is a **pure label** with no
//!    per-variant payload (`PlanStatus`, `VmzModuleKind`, …).
//! 3. **Tagged union** — default for closed discriminators:
//!    `#[serde(tag = "kind", rename_all = "kebab-case")] enum Node { A { .. }, B { .. } }`.
//!    Newtype families use `tag` + `content` (see [`IrDepPath`], protocol `StableId`).
//!
//! Serde naming (Rust is source of truth — do **not** sprinkle per-field `rename`):
//!
//! - Struct fields: container `#[serde(rename_all = "camelCase")]`.
//! - Enum kind / tag values: container `#[serde(rename_all = "kebab-case")]`.
//! - Tagged-union variant fields: also `rename_all_fields = "camelCase"` when needed.
//! - Per-field `rename` only for intentional exceptions (legacy keys, host `snake_case`
//!   stages, `WebView` casing that mechanical camelCase cannot produce).
//!
//! Smell test: if call sites write `x.kind == Foo` / `match x.kind` and then read
//! different fields, `x` should be a tagged union — not `struct { kind: Enum, … }`.
//! A separate `FooKind` unit enum is only a Copy filter helper (see [`PlanNodeKind`]).
//!
//! Skip empty payloads: `Option` / empty `String` / empty `Vec` via [`serde_util`].

#![deny(missing_docs)]
mod component;
mod dep_key;
mod program_ir;
mod reactive_ir;
pub mod schema_export;
pub mod serde_util;

pub use component::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};
pub use dep_key::{DepKey, DepPath, PathSegment, WriteNotice};
pub use program_ir::{
    AnalysisStats, CapabilityId, ClientServerCall, DeploymentClientCall, DeploymentView,
    DisposeRegionSource, ExecutionPlan, GraphView, LifetimeRegionDecl, LifetimeRegionKind,
    LifetimeView, MotionTransitionDecl, MotionTransitionKind, MotionTransitionState, MotionTrigger,
    MotionView, PlanNode, PlanNodeKind, PlanStatus, ProgramEdge, ProgramEdgeKind, ProgramModule,
    ProgramUnit, ProgramUnitKind, ReducedMotionPolicy, ResourceDecl, ResourceKind, ResourceView,
    ResumeEntryDecl, ResumeStrategy, RouteTabDecl, SecretRequirement, SemanticField,
    SemanticMethod, SemanticView, ServerAttach, ServerCallEdge, ServerCapability, ServerView,
    StubStatus, UnitId, UnknownRecord, ViewAttr, ViewAttrValue, ViewEach, ViewIfBranch, ViewNode,
    ViewStatus, ViewView,
};
pub use reactive_ir::{
    Binding, BindingId, BindingKind, ControlBranch, ControlRegion, DynamicStep, Effect, EffectId,
    ExprId, ExprSlot, FieldId, IrDepPath, ListItemFrame, PropertyId, PropertySlot,
    ReactiveComponent, ReactiveComponentBuilder, ReactiveModule, RegionId, StateSlot, WritePath,
};
pub use schema_export::{
    IR_SCHEMA_CATALOG, IrDocumentKind, IrSchemaCatalog, IrSchemaEntry, execution_plan_schema,
    execution_plan_schema_json, ir_schema_catalog, ir_schema_catalog_json, program_module_schema,
    program_module_schema_json, reactive_module_schema, reactive_module_schema_json,
};

/// Re-export schema ids used when emitting Program / Plan / Reactive JSON.
pub use vmz_protocol::{
    MOTION_SCHEMA, MOTION_TRANSITION_SCHEMA, PLAN_SCHEMA, PROGRAM_SCHEMA, REACTIVE_SCHEMA,
};

/// Re-export the oxc span primitives we standardize on.
pub mod span {
    pub use oxc_span::{GetSpan, SourceType, Span};
}

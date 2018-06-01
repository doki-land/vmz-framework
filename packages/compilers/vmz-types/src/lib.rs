//! VMZ-specific types on top of the oxc toolchain.
//!
//! Spans, source ids, diagnostics, AST, and parsing come from oxc.
//! This crate only models `.vmz` component conventions that oxc does not own.
//! Versioned wire protocols live in `vmz-protocol`.

#![warn(missing_docs)]
mod component;
mod dep_key;
mod program_ir;
mod reactive_ir;
pub mod schema_export;

pub use component::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};
pub use dep_key::{DepKey, DepPath, PathSegment, WriteNotice};
pub use program_ir::{
    AnalysisStats, CapabilityId, ClientServerCall, DeploymentClientCall, DeploymentView,
    ExecutionPlan, GraphView, LifetimeRegionDecl, LifetimeView, MotionTransitionDecl, MotionView,
    PlanNode, PlanStatus, ProgramEdge, ProgramModule, ProgramUnit, ProgramUnitKind, ResourceDecl,
    ResourceView, ResumeEntryDecl, SecretRequirement, SemanticField, SemanticMethod, SemanticView,
    ServerAttach, ServerCallEdge, ServerCapability, ServerView, StubStatus, UnitId, UnknownRecord,
    ViewAttr, ViewAttrValue, ViewEach, ViewIfBranch, ViewNode, ViewStatus, ViewView,
};
pub use reactive_ir::{
    Binding, BindingId, BindingKind, ControlBranch, ControlRegion, DynamicStep, Effect, EffectId,
    ExprId, ExprSlot, FieldId, IrDepPath, ListItemFrame, PropertyId, PropertySlot,
    ReactiveComponent, ReactiveComponentBuilder, ReactiveModule, RegionId, StateSlot, WritePath,
    reactive_component_json,
};
pub use schema_export::{
    program_module_schema, program_module_schema_json, reactive_module_schema,
    reactive_module_schema_json,
};

/// Re-export schema ids used when emitting Program / Plan / Reactive JSON.
pub use vmz_protocol::{
    MOTION_SCHEMA, MOTION_TRANSITION_SCHEMA, PLAN_SCHEMA, PROGRAM_SCHEMA, REACTIVE_SCHEMA,
};

/// Re-export the oxc span primitives we standardize on.
pub mod span {
    pub use oxc_span::{GetSpan, SourceType, Span};
}

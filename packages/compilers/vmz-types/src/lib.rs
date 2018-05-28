//! VMZ-specific types on top of the oxc toolchain.
//!
//! Spans, source ids, diagnostics, AST, and parsing come from oxc.
//! This crate only models `.vmz` component conventions that oxc does not own.
//! Versioned wire protocols live in `vmz-protocol`.

mod component;
mod dep_key;
mod program_ir;
mod reactive_ir;

pub use component::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};
pub use dep_key::{DepKey, DepPath, PathSeg, WriteNotice};
pub use program_ir::{
    AnalysisStats, CapabilityId, ClientServerCall, DeploymentView, ExecutionPlan, GraphView,
    LifetimeRegionDecl, LifetimeView, PlanNode, PlanStatus, ProgramEdge, ProgramModule,
    ProgramUnit, ProgramUnitKind, ResourceDecl, ResourceView, ResumeEntryDecl, SemanticField,
    SemanticMethod, SemanticView, ServerAttach, ServerCallEdge, ServerCapability, ServerView,
    StubStatus, UnitId, UnknownRecord, ViewAttr, ViewAttrValue, ViewEach, ViewIfBranch, ViewNode,
    ViewStatus, ViewView,
};
pub use reactive_ir::{
    Binding, BindingId, BindingKind, ControlBranch, ControlRegion, DynamicStep, Effect, EffectId,
    ExprId, ExprSlot, FieldId, IrDepPath, ListItemFrame, PropertyId, PropertySlot,
    ReactiveComponent, ReactiveComponentBuilder, ReactiveModule, RegionId, StateSlot, WritePath,
    reactive_component_json,
};

/// Re-export schema ids used when emitting Program / Plan JSON.
pub use vmz_protocol::{PLAN_SCHEMA, PROGRAM_SCHEMA};

/// Re-export the oxc span primitives we standardize on.
pub mod span {
    pub use oxc_span::{GetSpan, SourceType, Span};
}

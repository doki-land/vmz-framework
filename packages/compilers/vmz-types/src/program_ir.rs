//! VMZ Program IR shell -- unified program graph.
//!
//! Reactive IR ([`crate::reactive_ir`]) is one **view** of this graph, not the core.
//! Other views start as stubs that share the same unit identity and field/binding ids.
//!
//! `ProgramModule` + `*.program.json` so tools stop treating
//! `ReactiveModule` as the only extension surface.

use crate::reactive_ir::{
    BindingId, EffectId, FieldId, IrDepPath, ReactiveComponent, ReactiveModule, RegionId,
};
use crate::{FieldKind, HttpRoute};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use vmz_protocol::{PLAN_SCHEMA, PROGRAM_SCHEMA, REACTIVE_SCHEMA, VmzModuleKind};

/// Stable id of a [`ProgramUnit`] within one [`ProgramModule`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct UnitId {
    /// Numeric id within the module.
    pub unit_id: u32,
}

/// Authoring / deployment kind of a program unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProgramUnitKind {
    /// `.vmz` client component (may also host co-located server class edges later).
    Component,
    /// Standalone `#server` / server class module (stub until Server view fills in).
    ServerClass,
    /// Plain shared TS module (stub).
    Module,
}

impl ProgramUnitKind {
    /// Wire / JSON label for this unit kind (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Component => "component",
            Self::ServerClass => "server-class",
            Self::Module => "module",
        }
    }
}

/// One `.vmz` / module file's program graph snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProgramModule {
    /// Wire schema id ([`PROGRAM_SCHEMA`]).
    pub schema: String,
    /// Workspace-relative source path.
    pub source: String,
    /// Compilable units in this module.
    pub units: Vec<ProgramUnit>,
}

/// One compilable unit with layered views sharing field/binding ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProgramUnit {
    /// Stable unit id within the owning [`ProgramModule`].
    pub id: UnitId,
    /// Unit name (component / class / module stem).
    pub name: String,
    /// Authoring / deployment kind of this unit.
    pub kind: ProgramUnitKind,
    /// Semantic symbols shared across views.
    pub semantic: SemanticView,
    /// Reactive analysis view of this unit.
    pub reactive: ReactiveComponent,
    /// Structural / Native View projection.
    pub view: ViewView,
    /// Shared Execution Plan derived from Native View (Browser/SSR/Test lowerings).
    pub plan: ExecutionPlan,
    /// Resource / async projection from effects and server caps.
    pub resource: ResourceView,
    /// Motion transitions projected from Native View + cancel/generation contract.
    pub motion: MotionView,
    /// Lifetime regions projected from control / each / unit ownership.
    pub lifetime: LifetimeView,
    /// Co-located `#server` / server class surface.
    pub server: ServerView,
    /// Island / chunk / resume deployment projection.
    pub deployment: DeploymentView,
    /// Projected reads/writes/calls + Unknown widenings (shared fact for check/explain).
    pub graph: GraphView,
}

/// Semantic symbols (fields / methods) -- shared identity for other views.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct SemanticView {
    /// Fields (props + state) with ids shared across views.
    pub fields: Vec<SemanticField>,
    /// Methods / effects with ids shared across views.
    pub methods: Vec<SemanticMethod>,
}

/// One semantic field shared across views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SemanticField {
    /// Same numeric id as [`FieldId`] in the reactive view.
    pub id: FieldId,
    /// Source field name.
    pub name: String,
    /// Prop vs state classification.
    pub kind: FieldKind,
}

/// One semantic method shared across views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SemanticMethod {
    /// Same numeric id as [`EffectId`] when the method has an effect summary.
    pub id: EffectId,
    /// Method name as written in source.
    pub name: String,
    /// True when the method crosses an async boundary.
    pub async_boundary: bool,
}

/// Structural / Native View -- first-class query view of the unified Program Graph.
///
/// When [`ViewStatus::Native`], [`Self::roots`] is the sole structure source for
/// direct emit (`emit_direct`); TemplateIr must not be re-scanned for if/each/element.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ViewView {
    /// Whether this view carries a structural tree or only id lists.
    pub status: ViewStatus,
    /// Binding ids projected from the reactive view.
    pub binding_ids: Vec<BindingId>,
    /// Region ids projected from the reactive view.
    pub region_ids: Vec<RegionId>,
    /// Structural tree (empty when [`ViewStatus::DerivedFromReactive`]).
    pub roots: Vec<ViewNode>,
}

/// Whether Native View carries a structural tree or only reactive id lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ViewStatus {
    /// Legacy ID-list projection only (no structural tree).
    #[default]
    DerivedFromReactive,
    /// Structural tree populated; emitter consumes [`ViewView::roots`].
    Native,
}

impl ViewStatus {
    /// Wire / JSON label for this view status (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DerivedFromReactive => "derived-from-reactive",
            Self::Native => "native",
        }
    }
}

/// One node in the Native View structural tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ViewNode {
    /// Static text leaf.
    Text {
        /// Literal text content.
        value: String,
    },
    /// Text interpolation (`{expr}`).
    Interp {
        /// Source expression text.
        expr: String,
        /// Binding that owns this interpolation, when known.
        binding: Option<BindingId>,
    },
    /// DOM / host element with optional `each`.
    Element {
        /// Element tag name.
        tag: String,
        /// Element attributes.
        attrs: Vec<ViewAttr>,
        /// Child nodes.
        children: Vec<ViewNode>,
        /// Optional `each` metadata when this element iterates a list.
        each: Option<ViewEach>,
    },
    /// Conditional `if` / `else-if` / `else` tree.
    If {
        /// Control region for this conditional, when known.
        region: Option<RegionId>,
        /// Binding for the primary condition, when known.
        binding: Option<BindingId>,
        /// Ordered branches of the conditional.
        branches: Vec<ViewIfBranch>,
    },
    /// Child component instantiation.
    Component {
        /// Component tag / name.
        tag: String,
        /// Props and directives as attributes.
        attrs: Vec<ViewAttr>,
        /// Slot / default children.
        children: Vec<ViewNode>,
    },
    /// Named or default slot.
    Slot {
        /// Slot name; `None` means the default slot.
        name: Option<String>,
        /// Attributes on the slot outlet.
        attrs: Vec<ViewAttr>,
        /// Fallback / projected children.
        children: Vec<ViewNode>,
    },
}

/// Attribute on a view element / component / slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewAttr {
    /// Attribute name (may include `client:` / `data-vmz-*` prefixes).
    pub name: String,
    /// Static, interpolated, or bare value form.
    pub value: ViewAttrValue,
    /// Binding that owns this attribute, when known.
    pub binding: Option<BindingId>,
}

/// Attribute value forms in Native View.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ViewAttrValue {
    /// Compile-time constant string.
    Static {
        /// Literal attribute value.
        value: String,
    },
    /// Interpolated expression attribute.
    Interp {
        /// Source expression text.
        expr: String,
    },
    /// Present without value (e.g. `else`).
    Bare,
}

/// `each` metadata on an element.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewEach {
    /// List expression source text.
    pub list_expr: String,
    /// Item binding name (`as` / implicit item).
    pub as_name: String,
    /// Optional key expression source text.
    pub key_expr: Option<String>,
    /// Binding for the list expression, when known.
    pub list_binding: Option<BindingId>,
    /// Binding for the key expression, when known.
    pub key_binding: Option<BindingId>,
    /// Control / lifetime region for this each.
    pub region: Option<RegionId>,
}

/// One branch of a view `if`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewIfBranch {
    /// Condition source text; `None` for the final `else` arm.
    pub cond: Option<String>,
    /// Body root for this branch.
    pub body: Box<ViewNode>,
}

/// Thin Execution Plan -- schedule derived from Native View (not a competing IR).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExecutionPlan {
    /// Wire schema id ([`PLAN_SCHEMA`]).
    pub schema: String,
    /// Population status of this plan.
    pub status: PlanStatus,
    /// Root plan node ids (entry points of the schedule).
    pub root_ids: Vec<u32>,
    /// Flat list of scheduled structural nodes.
    pub nodes: Vec<PlanNode>,
}

impl Default for ExecutionPlan {
    fn default() -> Self {
        Self {
            schema: PLAN_SCHEMA.into(),
            status: PlanStatus::Empty,
            root_ids: Vec::new(),
            nodes: Vec::new(),
        }
    }
}

/// Population status of an [`ExecutionPlan`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum PlanStatus {
    /// No plan nodes projected yet.
    #[default]
    Empty,
    /// Populated from Native View roots.
    Partial,
}

impl PlanStatus {
    /// Wire / JSON label for this plan status (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Partial => "partial",
        }
    }
}

/// Closed discriminant for [`PlanNode`] (unit enum for filters / allow-lists).
///
/// Matching payload fields should use the [`PlanNode`] tagged union itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum PlanNodeKind {
    /// Temporary placeholder while children are built (never left in final plans).
    Pending,
    /// Static text leaf.
    Text,
    /// Text interpolation.
    Interp,
    /// Host element.
    Element,
    /// Keyed list region (`each`).
    Each,
    /// Conditional region (`if`).
    If,
    /// Child component mount.
    Component,
    /// Slot projection.
    Slot,
    /// LifetimeRegion dispose schedule entry.
    DisposeRegion,
    /// Motion transition schedule entry.
    MotionTransition,
}

impl PlanNodeKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Text => "text",
            Self::Interp => "interp",
            Self::Element => "element",
            Self::Each => "each",
            Self::If => "if",
            Self::Component => "component",
            Self::Slot => "slot",
            Self::DisposeRegion => "dispose-region",
            Self::MotionTransition => "motion-transition",
        }
    }

    /// Kinds that map to target-neutral View Ops (excludes [`Self::Pending`]).
    pub const VIEW_OPS: &[Self] = &[
        Self::Text,
        Self::Interp,
        Self::Element,
        Self::If,
        Self::Each,
        Self::Component,
        Self::Slot,
        Self::DisposeRegion,
        Self::MotionTransition,
    ];
}

/// Closed source label for a [`PlanNode::DisposeRegion`] (not an open string).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DisposeRegionSource {
    /// Region originated from an `if` control tree.
    If,
    /// Region originated from an `each` list.
    Each,
}

impl DisposeRegionSource {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::If => "if",
            Self::Each => "each",
        }
    }
}

/// One scheduled structural node in the shared plan.
///
/// **Tagged union** (closed): serde `tag = "kind"` + per-variant payload.
/// Prefer this over a flat `struct { kind: PlanNodeKind, tag?, binding?, … }`.
/// Open / unknown kinds belong only in scanners and negative tests, never here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PlanNode {
    /// Temporary placeholder while children are built (never left in final plans).
    Pending {
        /// Stable plan node id within this unit's plan.
        id: u32,
    },
    /// Static text leaf.
    Text {
        /// Stable plan node id within this unit's plan.
        id: u32,
    },
    /// Text interpolation.
    Interp {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Binding id when this node is driven by a binding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        binding: Option<u32>,
    },
    /// Host element.
    Element {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Element tag when known.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        tag: Option<String>,
        /// Binding id when this node is driven by a binding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        binding: Option<u32>,
        /// Region id when confined to a control / lifetime region.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<u32>,
        /// Child plan node ids.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<u32>,
    },
    /// Keyed list region (`each`).
    Each {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Host element tag wrapping the list, when known.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        tag: Option<String>,
        /// List binding id when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        binding: Option<u32>,
        /// Lifetime / control region id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<u32>,
        /// Child plan node ids (template body).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<u32>,
    },
    /// Conditional region (`if`).
    If {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Binding for the primary condition, when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        binding: Option<u32>,
        /// Control region id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<u32>,
        /// Body plan node id per branch (same order as ViewIfBranch).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        branches: Vec<u32>,
    },
    /// Child component mount.
    Component {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Component tag / name.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        tag: Option<String>,
        /// Child plan node ids (default slot body).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<u32>,
    },
    /// Slot projection.
    Slot {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Slot name; `None` / omitted means default slot (`"slot"` may also appear).
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        tag: Option<String>,
        /// Fallback / projected child plan node ids.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        children: Vec<u32>,
    },
    /// LifetimeRegion dispose schedule entry.
    DisposeRegion {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Region id being disposed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<u32>,
        /// Closed origin of the region (`if` | `each`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<DisposeRegionSource>,
    },
    /// Motion transition schedule entry.
    MotionTransition {
        /// Stable plan node id within this unit's plan.
        id: u32,
        /// Reachable LifetimeRegion when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<u32>,
        /// Transition name / surface label.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        tag: Option<String>,
    },
}

impl PlanNode {
    /// Stable plan node id within this unit's plan.
    pub fn id(&self) -> u32 {
        match self {
            Self::Pending { id }
            | Self::Text { id }
            | Self::Interp { id, .. }
            | Self::Element { id, .. }
            | Self::Each { id, .. }
            | Self::If { id, .. }
            | Self::Component { id, .. }
            | Self::Slot { id, .. }
            | Self::DisposeRegion { id, .. }
            | Self::MotionTransition { id, .. } => *id,
        }
    }

    /// Closed discriminant for this node.
    pub fn kind(&self) -> PlanNodeKind {
        match self {
            Self::Pending { .. } => PlanNodeKind::Pending,
            Self::Text { .. } => PlanNodeKind::Text,
            Self::Interp { .. } => PlanNodeKind::Interp,
            Self::Element { .. } => PlanNodeKind::Element,
            Self::Each { .. } => PlanNodeKind::Each,
            Self::If { .. } => PlanNodeKind::If,
            Self::Component { .. } => PlanNodeKind::Component,
            Self::Slot { .. } => PlanNodeKind::Slot,
            Self::DisposeRegion { .. } => PlanNodeKind::DisposeRegion,
            Self::MotionTransition { .. } => PlanNodeKind::MotionTransition,
        }
    }

    /// Binding id when this variant carries one.
    pub fn binding(&self) -> Option<u32> {
        match self {
            Self::Interp { binding, .. }
            | Self::Element { binding, .. }
            | Self::Each { binding, .. }
            | Self::If { binding, .. } => *binding,
            _ => None,
        }
    }

    /// Region id when this variant carries one.
    pub fn region(&self) -> Option<u32> {
        match self {
            Self::Element { region, .. }
            | Self::Each { region, .. }
            | Self::If { region, .. }
            | Self::DisposeRegion { region, .. }
            | Self::MotionTransition { region, .. } => *region,
            _ => None,
        }
    }

    /// Tag / name / motion label when this variant carries one.
    pub fn tag(&self) -> Option<&str> {
        match self {
            Self::Element { tag, .. }
            | Self::Each { tag, .. }
            | Self::Component { tag, .. }
            | Self::Slot { tag, .. }
            | Self::MotionTransition { tag, .. } => tag.as_deref(),
            Self::DisposeRegion { source, .. } => source.map(|s| s.as_str()),
            _ => None,
        }
    }

    /// Child plan node ids when this variant carries them.
    pub fn children(&self) -> &[u32] {
        match self {
            Self::Element { children, .. }
            | Self::Each { children, .. }
            | Self::Component { children, .. }
            | Self::Slot { children, .. } => children.as_slice(),
            _ => &[],
        }
    }

    /// Branch body plan node ids when this is [`Self::If`].
    pub fn branches(&self) -> &[u32] {
        match self {
            Self::If { branches, .. } => branches.as_slice(),
            _ => &[],
        }
    }
}

/// Resource / async view projected from effects + server caps.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ResourceView {
    /// Whether any resources have been projected yet.
    pub status: StubStatus,
    /// Async tasks and server / HTTP resources owned by this unit.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<ResourceDecl>,
}

/// Kind of a [`ResourceDecl`] (unit enum for filters; payload lives on the tagged union).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind {
    /// Client async effect / task.
    AsyncTask,
    /// Co-located server capability.
    ServerCapability,
    /// HTTP route surface.
    Http,
}

impl ResourceKind {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AsyncTask => "async-task",
            Self::ServerCapability => "server-capability",
            Self::Http => "http",
        }
    }
}

/// One async / server resource owned by this unit.
///
/// **Tagged union**: `states` / cancel protocol belong only on [`Self::AsyncTask`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ResourceDecl {
    /// Client async effect / task with cancel + generation protocol.
    AsyncTask {
        /// Stable resource id within this unit.
        id: u32,
        /// Resource / method name.
        name: String,
        /// Owning client method / effect when known.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        owner: Option<String>,
        /// AsyncTask protocol states.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        states: Vec<String>,
        /// Whether the resource participates in cancel protocol.
        cancelable: bool,
        /// Generation / supersede protocol (same as runtime `__vmzRunTask`).
        generation: bool,
    },
    /// Co-located server capability.
    ServerCapability {
        /// Stable resource id within this unit.
        id: u32,
        /// Capability / method name.
        name: String,
        /// Owning server class when known.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        owner: Option<String>,
    },
    /// HTTP route surface.
    Http {
        /// Stable resource id within this unit.
        id: u32,
        /// Route / method name.
        name: String,
        /// Owning server class when known.
        #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
        owner: Option<String>,
    },
}

impl ResourceDecl {
    /// Stable resource id within this unit.
    pub fn id(&self) -> u32 {
        match self {
            Self::AsyncTask { id, .. }
            | Self::ServerCapability { id, .. }
            | Self::Http { id, .. } => *id,
        }
    }

    /// Closed discriminant.
    pub fn kind(&self) -> ResourceKind {
        match self {
            Self::AsyncTask { .. } => ResourceKind::AsyncTask,
            Self::ServerCapability { .. } => ResourceKind::ServerCapability,
            Self::Http { .. } => ResourceKind::Http,
        }
    }

    /// Resource / method name.
    pub fn name(&self) -> &str {
        match self {
            Self::AsyncTask { name, .. }
            | Self::ServerCapability { name, .. }
            | Self::Http { name, .. } => name.as_str(),
        }
    }

    /// Owning method / class when known.
    pub fn owner(&self) -> Option<&str> {
        match self {
            Self::AsyncTask { owner, .. }
            | Self::ServerCapability { owner, .. }
            | Self::Http { owner, .. } => owner.as_deref(),
        }
    }
}

/// Motion view -- Program Graph projection of UI transitions.
///
/// Not a second animation runtime: facts only (owner, trigger, region, cancel, generation).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct MotionView {
    /// Whether any transitions have been projected yet.
    pub status: StubStatus,
    /// Motion transitions owned by this unit.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<MotionTransitionDecl>,
}

/// Kind of a [`MotionTransitionDecl`] (serde enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTransitionKind {
    /// Overlay enter transition.
    OverlayEnter,
    /// Overlay exit transition.
    OverlayExit,
    /// Control / focus transition.
    Control,
}

impl MotionTransitionKind {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OverlayEnter => "overlay-enter",
            Self::OverlayExit => "overlay-exit",
            Self::Control => "control",
        }
    }
}

/// Closed motion trigger vocabulary for [`MotionTransitionDecl`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTrigger {
    /// Overlay open / enter.
    Open,
    /// Overlay dismiss / exit.
    Dismiss,
    /// Control / focus transition.
    Control,
}

impl MotionTrigger {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Dismiss => "dismiss",
            Self::Control => "control",
        }
    }
}

impl std::fmt::Display for MotionTrigger {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Closed motion transition state vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTransitionState {
    /// Entering presentation.
    Enter,
    /// Exiting presentation.
    Exit,
    /// Stable / idle presentation.
    Stable,
    /// Immediate control feedback (non-overlay).
    Feedback,
    /// Cancelled before completion.
    Cancelled,
    /// Completed successfully.
    Completed,
}

impl MotionTransitionState {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Enter => "enter",
            Self::Exit => "exit",
            Self::Stable => "stable",
            Self::Feedback => "feedback",
            Self::Cancelled => "cancelled",
            Self::Completed => "completed",
        }
    }
}

impl std::fmt::Display for MotionTransitionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Closed reduced-motion policy for [`MotionTransitionDecl`].
///
/// `honor` = prefers-reduced-motion changes presentation, not final state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ReducedMotionPolicy {
    /// Honor prefers-reduced-motion without changing final state.
    #[default]
    Honor,
}

impl ReducedMotionPolicy {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Honor => "honor",
        }
    }

    fn is_default(&self) -> bool {
        matches!(self, Self::Honor)
    }
}

impl std::fmt::Display for ReducedMotionPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One motion transition owned by this unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct MotionTransitionDecl {
    /// Stable transition id within this unit.
    pub id: u32,
    /// Transition kind (serde `kebab-case` enum).
    pub kind: MotionTransitionKind,
    /// Human / wire name (often `{surface}.{kind}`).
    pub name: String,
    /// Owning unit / surface name.
    pub owner: String,
    /// Trigger event / method / prop (closed [`MotionTrigger`]).
    pub trigger: MotionTrigger,
    /// Reachable LifetimeRegion when known (overlay inside `if`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<u32>,
    /// Style Theme token family (`motion.overlay` | `motion.control`).
    pub token: String,
    /// Transition states (closed [`MotionTransitionState`], subset by kind).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub states: Vec<MotionTransitionState>,
    /// Whether reverse / destroy can cancel this transition.
    pub cancelable: bool,
    /// Whether generation / supersede protocol applies.
    pub generation: bool,
    /// Reduced-motion policy (closed [`ReducedMotionPolicy`]).
    #[serde(default, skip_serializing_if = "ReducedMotionPolicy::is_default")]
    pub reduced_motion: ReducedMotionPolicy,
}

/// Lifetime / ownership projection -- not a competing IR.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct LifetimeView {
    /// Whether any lifetime regions have been projected yet.
    pub status: StubStatus,
    /// Lifetime regions sharing ids with control / each.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<LifetimeRegionDecl>,
}

/// Kind of a [`LifetimeRegionDecl`] (serde enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum LifetimeRegionKind {
    /// Conditional region.
    If,
    /// List region.
    Each,
    /// Ternary expression region.
    Ternary,
    /// Unclassified / opaque region.
    Unknown,
}

impl LifetimeRegionKind {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::If => "if",
            Self::Each => "each",
            Self::Ternary => "ternary",
            Self::Unknown => "unknown",
        }
    }
}

/// One LifetimeRegion on the Program Graph (shares RegionId with control/each).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LifetimeRegionDecl {
    /// Same numeric id as the reactive / view [`RegionId`].
    pub id: u32,
    /// Region kind (serde `kebab-case` enum).
    pub kind: LifetimeRegionKind,
    /// Owning unit name (component is author boundary; region is execute boundary).
    pub owner_unit: String,
}

/// First-class graph edges + Unknown provenance.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct GraphView {
    /// Whether any edges / unknowns have been projected yet.
    pub status: StubStatus,
    /// Directed Program Graph edges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges: Vec<ProgramEdge>,
    /// Provenance records for Unknown path widenings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknowns: Vec<UnknownRecord>,
    /// Analysis closed-loop metrics.
    pub analysis: AnalysisStats,
}

/// Binding / effect path precision counts for analysis progress.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct AnalysisStats {
    /// Field / StaticPath / DynamicPath / ListItem reads+writes.
    pub exact: u32,
    /// Unknown with a specific widen reason (opaque / destructure / closure...).
    pub widened: u32,
    /// Unknown with only generic `field_star` provenance.
    pub unknown: u32,
    /// `calls` edges on effects.
    pub call_edges: u32,
}

/// Kind of a [`ProgramEdge`] (serde enum) — owned by `vmz-protocol` for wire sharing.
pub use vmz_protocol::ProgramEdgeKind;

/// One directed Program Graph edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProgramEdge {
    /// Edge kind (serde `kebab-case` enum).
    pub kind: ProgramEdgeKind,
    /// Edge source node id / label.
    pub from: String,
    /// Edge target node id / label.
    pub to: String,
}

/// Provenance for an Unknown path widening.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct UnknownRecord {
    /// Field or path that was widened.
    pub field: String,
    /// Widen reason (`opaque` / `destructure` / `closure` / ...).
    pub reason: String,
    /// Analysis site that introduced the widen.
    pub via: String,
}

/// Server capability view -- co-located `#server` / server class surface.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ServerView {
    /// Population status of this server projection.
    pub status: StubStatus,
    /// Virtual module id, e.g. `#server/components/UserCard`.
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub module_id: Option<String>,
    /// Server class name when present.
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub class_name: Option<String>,
    /// Exposed server methods as capabilities.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<ServerCapability>,
    /// Proven client -> capability call edges (static surface match; not full CFG yet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<ServerCallEdge>,
    /// Compiler-known secret bindings (names only -- never values).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub secret_requirements: Vec<SecretRequirement>,
    /// True when this server slice has no secret requirements (browser-safe placement).
    pub browser_safe: bool,
}

/// One `SecretRequirement` fact projected from `#server/secrets` / `secret('NAME')`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SecretRequirement {
    /// Environment binding name (`PAYMENTS_API_KEY`) -- not a value.
    pub binding_name: String,
    /// Owning capability / method when known.
    pub owner_capability: Option<String>,
    /// Virtual module id of the server unit.
    pub module_id: Option<String>,
}

/// Stable id of a server capability within one [`ProgramUnit`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct CapabilityId(pub u32);

/// One server method exposed as a capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ServerCapability {
    /// Stable capability id within the unit.
    pub id: CapabilityId,
    /// Server method name.
    pub method: String,
    /// True when the method crosses an async boundary.
    pub async_boundary: bool,
    /// True when the method is `private` (not part of the RPC surface).
    pub is_private: bool,
    /// Non-private methods are callable from client stubs (RPC surface).
    pub callable_from_client: bool,
    /// Optional HTTP route binding for this capability.
    pub http: Option<HttpRoute>,
}

/// Proven client -> capability call edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ServerCallEdge {
    /// Target capability id.
    pub capability: CapabilityId,
    /// Server method name (mirrors the capability).
    pub method: String,
    /// Client method / effect name when known (e.g. `onMount`).
    pub from_client_method: Option<String>,
}

/// Proven client -> server method call (filled by compiler oxc walk).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ClientServerCall {
    /// Server method name invoked from the client.
    pub server_method: String,
    /// Enclosing client method when known.
    pub from_client_method: Option<String>,
}

/// Input for attaching a co-located server class onto a component unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerAttach {
    /// Virtual `#server/...` module id.
    pub module_id: String,
    /// Server class name.
    pub class_name: String,
    /// Analyzed server methods.
    pub methods: Vec<crate::MethodDecl>,
    /// oxc-discovered `Class.method` calls with enclosing client method when known.
    pub client_calls: Vec<ClientServerCall>,
    /// Secret bindings collected from server script (`secret('NAME')`).
    pub secret_requirements: Vec<SecretRequirement>,
}

/// Client -> server method edge recorded on the deployment view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentClientCall {
    /// Server capability method name.
    pub method: String,
    /// Enclosing client method when known.
    pub from_client_method: Option<String>,
}

/// Deployment / Island / chunk view.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentView {
    /// Population status of this deployment projection.
    pub status: StubStatus,
    /// Module kind (closed [`VmzModuleKind`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_kind: Option<VmzModuleKind>,
    /// Stable chunk id within the project (posix-style relative stem).
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub chunk_id: Option<String>,
    /// Client JS entry relative to out_dir.
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub client_entry: Option<String>,
    /// Program IR path relative to out_dir.
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub program_ir: Option<String>,
    /// Control region ids projected from the Reactive / View layer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub region_ids: Vec<u32>,
    /// Server capability method names owned by this unit.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    /// Virtual `#server/...` module id when co-located server exists.
    #[serde(default, skip_serializing_if = "crate::serde_util::is_none_or_empty_string")]
    pub server_module_id: Option<String>,
    /// Client method -> server capability edges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub client_calls: Vec<DeploymentClientCall>,
    /// Island / ResumeEntry products derived from View `client:*` (resume).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resume_entries: Vec<ResumeEntryDecl>,
}

/// Closed Island hydration strategy for [`ResumeEntryDecl`] (`client:*`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ResumeStrategy {
    /// Hydrate when idle (requestIdleCallback-class).
    Idle,
    /// Hydrate on load (default when `client:` has no suffix).
    #[default]
    Load,
    /// Hydrate when visible (IntersectionObserver-class).
    Visible,
    /// Lazy EventEntry: attach only after the host DOM event (`client:event`).
    Event,
}

impl ResumeStrategy {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Load => "load",
            Self::Visible => "visible",
            Self::Event => "event",
        }
    }

    /// Parse wire label; empty / unknown → [`Self::Load`].
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "load" => Self::Load,
            "idle" => Self::Idle,
            "visible" => Self::Visible,
            "event" | "click" => Self::Event,
            other if other.starts_with("event:") => Self::Event,
            _ => Self::Load,
        }
    }
}

impl std::fmt::Display for ResumeStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One Island resume product (SSR slice + client attach). Same Plan identity as Browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResumeEntryDecl {
    /// Component tag / name for the island.
    pub component: String,
    /// Hydration strategy (closed [`ResumeStrategy`]).
    pub strategy: ResumeStrategy,
    /// State keys hydrated into the island.
    pub state_keys: Vec<String>,
    /// Prop keys hydrated into the island.
    pub prop_keys: Vec<String>,
    /// Plan root ids of the island component unit when known; else empty.
    pub plan_root_ids: Vec<u32>,
}

/// Stub population status for projected views.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StubStatus {
    /// View not populated.
    #[default]
    Empty,
    /// View partially populated.
    Partial,
}

impl StubStatus {
    /// Wire / JSON label for this stub status.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Partial => "partial",
        }
    }
}

impl ProgramModule {
    /// Lift an existing Reactive snapshot into the Program IR shell.
    pub fn from_reactive(module: ReactiveModule) -> Self {
        let units = module
            .components
            .into_iter()
            .enumerate()
            .map(|(i, c)| ProgramUnit::from_reactive_component(UnitId { unit_id: i as u32 }, c))
            .collect();
        Self { schema: PROGRAM_SCHEMA.into(), source: module.source, units }
    }

    /// Project back to transitional [`ReactiveModule`] (tests / `*.reactive.json`).
    pub fn to_reactive_module(&self) -> ReactiveModule {
        ReactiveModule {
            schema: REACTIVE_SCHEMA.into(),
            source: self.source.clone(),
            components: self.units.iter().map(|u| u.reactive.clone()).collect(),
        }
    }

    /// Pretty-printed dump for tooling. **Not** a production artifact printer —
    /// write `*.program.json` via `vmz_generator::to_pretty_json` from the compiler.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

impl ProgramUnit {
    /// Collect Island ResumeEntry products from Native View `client:*` (resume).
    pub fn collect_resume_entries_from_view(&self) -> Vec<ResumeEntryDecl> {
        let mut out = Vec::new();
        fn walk(node: &ViewNode, out: &mut Vec<ResumeEntryDecl>) {
            match node {
                ViewNode::Component { tag, attrs, children } => {
                    let mut strategy = None;
                    for a in attrs {
                        if let Some(s) = a.name.strip_prefix("client:") {
                            strategy = Some(ResumeStrategy::parse(s));
                        }
                    }
                    if let Some(strategy) = strategy {
                        out.push(ResumeEntryDecl {
                            component: tag.clone(),
                            strategy,
                            state_keys: Vec::new(),
                            prop_keys: Vec::new(),
                            plan_root_ids: Vec::new(),
                        });
                    }
                    for c in children {
                        walk(c, out);
                    }
                }
                ViewNode::Element { children, .. } | ViewNode::Slot { children, .. } => {
                    for c in children {
                        walk(c, out);
                    }
                }
                ViewNode::If { branches, .. } => {
                    for b in branches {
                        walk(&b.body, out);
                    }
                }
                ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
            }
        }
        for root in &self.view.roots {
            walk(root, &mut out);
        }
        out
    }

    /// Build a Program unit shell from a reactive component snapshot.
    pub fn from_reactive_component(id: UnitId, reactive: ReactiveComponent) -> Self {
        let semantic = SemanticView {
            fields: reactive
                .state_slots
                .iter()
                .map(|s| SemanticField { id: s.id, name: s.name.clone(), kind: s.kind })
                .collect(),
            methods: reactive
                .effects
                .iter()
                .map(|e| SemanticMethod {
                    id: e.id,
                    name: e.name.clone(),
                    async_boundary: e.async_boundary,
                })
                .collect(),
        };
        let view = ViewView {
            status: ViewStatus::DerivedFromReactive,
            binding_ids: reactive.bindings.iter().map(|b| b.id()).collect(),
            region_ids: reactive.control_regions.iter().map(|r| r.id).collect(),
            roots: Vec::new(),
        };
        let mut unit = Self {
            id,
            name: reactive.name.clone(),
            kind: ProgramUnitKind::Component,
            semantic,
            reactive,
            view,
            plan: ExecutionPlan::default(),
            resource: ResourceView::default(),
            motion: MotionView::default(),
            lifetime: LifetimeView::default(),
            server: ServerView::default(),
            deployment: DeploymentView::default(),
            graph: GraphView::default(),
        };
        unit.rebuild_projected_views();
        unit
    }

    /// Attach co-located server capabilities (Program IR Server view).
    pub fn attach_server(&mut self, attach: &ServerAttach) {
        let mut capabilities = Vec::new();
        for m in &attach.methods {
            if m.name == "constructor" {
                continue;
            }
            let id = CapabilityId(capabilities.len() as u32);
            capabilities.push(ServerCapability {
                id,
                method: m.name.clone(),
                async_boundary: m.is_async,
                is_private: m.is_private,
                callable_from_client: !m.is_private,
                http: m.http.clone(),
            });
        }

        let mut calls = Vec::new();
        for hint in &attach.client_calls {
            let Some((cap_id, method)) = capabilities
                .iter()
                .find(|c| c.callable_from_client && c.method == hint.server_method)
                .map(|c| (c.id, c.method.clone()))
            else {
                continue;
            };
            if calls.iter().any(|e: &ServerCallEdge| {
                e.capability == cap_id && e.from_client_method == hint.from_client_method
            }) {
                continue;
            }
            calls.push(ServerCallEdge {
                capability: cap_id,
                method,
                from_client_method: hint.from_client_method.clone(),
            });
        }

        let mut secret_requirements = attach.secret_requirements.clone();
        for s in &mut secret_requirements {
            if s.module_id.is_none() {
                s.module_id = Some(attach.module_id.clone());
            }
        }
        let status = if capabilities.is_empty() && secret_requirements.is_empty() {
            StubStatus::Empty
        } else {
            StubStatus::Partial
        };
        self.server = ServerView {
            status,
            module_id: Some(attach.module_id.clone()),
            class_name: Some(attach.class_name.clone()),
            capabilities,
            calls,
            browser_safe: secret_requirements.is_empty(),
            secret_requirements,
        };
        self.rebuild_projected_views();
    }

    /// Recompute resource + graph projections from reactive / server views.
    pub fn rebuild_projected_views(&mut self) {
        let mut resources = Vec::new();
        let mut next_res = 0u32;
        for e in &self.reactive.effects {
            if e.async_boundary {
                // AsyncTask: pending/success/error/cancelled + cancel/generation protocol.
                resources.push(ResourceDecl::AsyncTask {
                    id: next_res,
                    name: e.name.clone(),
                    owner: Some(e.name.clone()),
                    states: vec![
                        "pending".into(),
                        "success".into(),
                        "error".into(),
                        "cancelled".into(),
                    ],
                    cancelable: true,
                    generation: true,
                });
                next_res += 1;
            }
        }
        for c in &self.server.capabilities {
            if c.http.is_some() {
                resources.push(ResourceDecl::Http {
                    id: next_res,
                    name: c.method.clone(),
                    owner: self.server.class_name.clone(),
                });
            } else {
                resources.push(ResourceDecl::ServerCapability {
                    id: next_res,
                    name: c.method.clone(),
                    owner: self.server.class_name.clone(),
                });
            }
            next_res += 1;
        }
        self.resource = ResourceView {
            status: if resources.is_empty() { StubStatus::Empty } else { StubStatus::Partial },
            resources,
        };

        // Motion transitions from Native View overlay/control markers + cancel methods.
        // Must run before graph edges; do not hold reactive borrows across this mutation.
        self.motion = project_motion_view(self);
        append_motion_plan_nodes(self);

        // LifetimeRegion projection from Native View + control regions (same RegionId).
        let mut kind_by_region: std::collections::BTreeMap<u32, LifetimeRegionKind> =
            std::collections::BTreeMap::new();
        fn walk_lifetime_kinds(
            node: &ViewNode,
            map: &mut std::collections::BTreeMap<u32, LifetimeRegionKind>,
        ) {
            match node {
                ViewNode::If { region, branches, .. } => {
                    if let Some(r) = region {
                        map.entry(r.0).or_insert(LifetimeRegionKind::If);
                    }
                    for b in branches {
                        walk_lifetime_kinds(&b.body, map);
                    }
                }
                ViewNode::Element { children, each, .. } => {
                    if let Some(e) = each
                        && let Some(r) = e.region
                    {
                        map.entry(r.0).or_insert(LifetimeRegionKind::Each);
                    }
                    for c in children {
                        walk_lifetime_kinds(c, map);
                    }
                }
                ViewNode::Component { children, .. } | ViewNode::Slot { children, .. } => {
                    for c in children {
                        walk_lifetime_kinds(c, map);
                    }
                }
                ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
            }
        }
        for root in &self.view.roots {
            walk_lifetime_kinds(root, &mut kind_by_region);
        }
        let mut lifetime_regions = Vec::new();
        for r in &self.reactive.control_regions {
            let kind = kind_by_region.get(&r.id.0).copied().unwrap_or(LifetimeRegionKind::Unknown);
            lifetime_regions.push(LifetimeRegionDecl {
                id: r.id.0,
                kind,
                owner_unit: self.name.clone(),
            });
        }
        self.lifetime = LifetimeView {
            status: if lifetime_regions.is_empty() {
                StubStatus::Empty
            } else {
                StubStatus::Partial
            },
            regions: lifetime_regions,
        };

        let fields = &self.reactive.state_slots;
        let props = &self.reactive.properties;
        let exprs = &self.reactive.exprs;

        let mut edges = Vec::new();
        let mut unknowns = Vec::new();
        let mut exact = 0u32;
        let mut widened = 0u32;
        let mut unknown = 0u32;
        let mut call_edges = 0u32;

        let classify = |path: &IrDepPath,
                        reason: &str,
                        exact: &mut u32,
                        widened: &mut u32,
                        unknown: &mut u32| {
            match path {
                IrDepPath::Unknown(_) => {
                    if reason == "field_star" {
                        *unknown += 1;
                    } else {
                        *widened += 1;
                    }
                }
                _ => *exact += 1,
            }
        };

        let reason_from_effect = |effect: &crate::reactive_ir::Effect, field: &str| -> String {
            if let Some((_, reason)) = effect.star_reasons.iter().find(|(f, _)| f == field) {
                return reason.clone();
            }
            if effect.opaque_callee {
                return "opaque_callee".into();
            }
            "field_star".into()
        };

        for b in &self.reactive.bindings {
            let via = format!("binding:{}", b.id().0);
            for r in b.reads() {
                let path = r.to_stable_string(fields, props, exprs);
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Reads,
                    from: via.clone(),
                    to: path.clone(),
                });
                if let IrDepPath::Unknown(id) = *r {
                    let field = fields
                        .iter()
                        .find(|s| s.id == id)
                        .map(|s| s.name.clone())
                        .unwrap_or_else(|| "?".into());
                    let reason = "field_star".to_string();
                    classify(r, &reason, &mut exact, &mut widened, &mut unknown);
                    unknowns.push(UnknownRecord { field, reason, via: via.clone() });
                } else {
                    classify(r, "", &mut exact, &mut widened, &mut unknown);
                }
            }
        }
        for e in &self.reactive.effects {
            let via = format!("effect:{}", e.name);
            for r in &e.reads {
                let path = r.to_stable_string(fields, props, exprs);
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Reads,
                    from: via.clone(),
                    to: path,
                });
                if let IrDepPath::Unknown(id) = r {
                    let field = fields
                        .iter()
                        .find(|s| s.id == *id)
                        .map(|s| s.name.clone())
                        .unwrap_or_else(|| "?".into());
                    let reason = reason_from_effect(e, &field);
                    classify(r, &reason, &mut exact, &mut widened, &mut unknown);
                    unknowns.push(UnknownRecord { field, reason, via: via.clone() });
                } else {
                    classify(r, "", &mut exact, &mut widened, &mut unknown);
                }
            }
            for w in &e.writes {
                let path = w.path.to_stable_string(fields, props, exprs);
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Writes,
                    from: via.clone(),
                    to: path.clone(),
                });
                if let IrDepPath::Unknown(id) = &w.path {
                    let field = fields
                        .iter()
                        .find(|s| s.id == *id)
                        .map(|s| s.name.clone())
                        .unwrap_or_else(|| "?".into());
                    let reason = reason_from_effect(e, &field);
                    classify(&w.path, &reason, &mut exact, &mut widened, &mut unknown);
                    unknowns.push(UnknownRecord { field, reason, via: via.clone() });
                } else {
                    classify(&w.path, "", &mut exact, &mut widened, &mut unknown);
                }
            }
            for callee in &e.calls {
                call_edges += 1;
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Calls,
                    from: via.clone(),
                    to: format!("method:{callee}"),
                });
            }
        }
        for r in &self.reactive.control_regions {
            let via = format!("region:{}", r.id.0);
            for p in &r.stable {
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::RegionStable,
                    from: via.clone(),
                    to: p.to_stable_string(fields, props, exprs),
                });
            }
        }
        // ownership edges: unit owns lifetime regions; regions/unit dispose resources.
        let unit_from = format!("unit:{}", self.name);
        for lr in &self.lifetime.regions {
            edges.push(ProgramEdge {
                kind: ProgramEdgeKind::Owns,
                from: unit_from.clone(),
                to: format!("region:{}", lr.id),
            });
        }
        for res in &self.resource.resources {
            edges.push(ProgramEdge {
                kind: ProgramEdgeKind::Disposes,
                from: unit_from.clone(),
                to: format!("resource:{}", res.id()),
            });
            // Regions share unit dispose of resources until finer ownership analysis.
            for lr in &self.lifetime.regions {
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Disposes,
                    from: format!("region:{}", lr.id),
                    to: format!("resource:{}", res.id()),
                });
            }
            if let ResourceDecl::AsyncTask { id, owner, .. } = res {
                let task = format!("task:{id}");
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Cancels,
                    from: "lifecycle:destroy".into(),
                    to: task.clone(),
                });
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Cancels,
                    from: unit_from.clone(),
                    to: task.clone(),
                });
                if let Some(owner) = owner {
                    edges.push(ProgramEdge {
                        kind: ProgramEdgeKind::Spawns,
                        from: format!("effect:{owner}"),
                        to: task,
                    });
                }
            }
        }
        for t in &self.motion.transitions {
            let motion = format!("motion:{}", t.id);
            edges.push(ProgramEdge {
                kind: ProgramEdgeKind::Owns,
                from: unit_from.clone(),
                to: motion.clone(),
            });
            edges.push(ProgramEdge {
                kind: ProgramEdgeKind::Spawns,
                from: format!("trigger:{}", t.trigger),
                to: motion.clone(),
            });
            if let Some(region) = t.region {
                // Region fine edge: transition is confined to a LifetimeRegion.
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Affects,
                    from: motion.clone(),
                    to: format!("region:{region}"),
                });
            }
            if t.cancelable {
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Cancels,
                    from: "lifecycle:destroy".into(),
                    to: motion.clone(),
                });
                edges.push(ProgramEdge {
                    kind: ProgramEdgeKind::Cancels,
                    from: "motion:reverse".into(),
                    to: motion.clone(),
                });
                if self.semantic.methods.iter().any(|m| m.name == "_cancelExit") {
                    edges.push(ProgramEdge {
                        kind: ProgramEdgeKind::Cancels,
                        from: "effect:_cancelExit".into(),
                        to: motion,
                    });
                }
            }
        }
        for c in &self.server.calls {
            let from = c
                .from_client_method
                .as_ref()
                .map(|m| format!("effect:{m}"))
                .unwrap_or_else(|| "client".into());
            edges.push(ProgramEdge {
                kind: ProgramEdgeKind::Calls,
                from,
                to: format!("capability:{}", c.method),
            });
        }

        self.graph = GraphView {
            status: if edges.is_empty() && unknowns.is_empty() {
                StubStatus::Empty
            } else {
                StubStatus::Partial
            },
            edges,
            unknowns,
            analysis: AnalysisStats { exact, widened, unknown, call_edges },
        };
    }
}

fn project_motion_view(unit: &ProgramUnit) -> MotionView {
    #[derive(Default)]
    struct Scan {
        overlay: Option<String>,
        overlay_region: Option<u32>,
        /// Author override via `data-vmz-motion-token` on overlay element.
        overlay_token: Option<String>,
        motion_kinds: Vec<String>,
        /// Author override via `data-vmz-motion-token` on control motion element.
        control_token: Option<String>,
    }
    fn walk(node: &ViewNode, region: Option<u32>, scan: &mut Scan) {
        match node {
            ViewNode::Element { attrs, children, each, .. } => {
                let mut next_region = region;
                if let Some(e) = each
                    && let Some(r) = e.region
                {
                    next_region = Some(r.0);
                }
                let mut overlay_here: Option<String> = None;
                let mut motion_here: Option<String> = None;
                let mut token_here: Option<String> = None;
                for a in attrs {
                    match (a.name.as_str(), &a.value) {
                        ("data-vmz-overlay", ViewAttrValue::Static { value: v }) => {
                            overlay_here = Some(v.clone());
                        }
                        ("data-vmz-motion", ViewAttrValue::Static { value: v }) => {
                            motion_here = Some(v.clone());
                        }
                        ("data-vmz-motion-token", ViewAttrValue::Static { value: v }) => {
                            token_here = Some(v.clone());
                        }
                        _ => {}
                    }
                }
                if let Some(v) = overlay_here {
                    scan.overlay = Some(v);
                    scan.overlay_region = region;
                    if let Some(tok) = &token_here {
                        scan.overlay_token = Some(tok.clone());
                    }
                }
                if let Some(v) = motion_here {
                    if !scan.motion_kinds.iter().any(|k| k == &v) {
                        scan.motion_kinds.push(v.clone());
                    }
                    if v == "control"
                        && let Some(tok) = &token_here
                    {
                        scan.control_token = Some(tok.clone());
                    }
                    // Overlay enter/exit markers may carry token on the motion element itself.
                    if (v == "overlay-enter" || v == "overlay-exit")
                        && scan.overlay_token.is_none()
                        && let Some(tok) = &token_here
                    {
                        scan.overlay_token = Some(tok.clone());
                    }
                }
                for c in children {
                    walk(c, next_region, scan);
                }
            }
            ViewNode::If { region: r, branches, .. } => {
                let next = r.map(|x| x.0).or(region);
                for b in branches {
                    walk(&b.body, next, scan);
                }
            }
            ViewNode::Component { children, .. } | ViewNode::Slot { children, .. } => {
                for c in children {
                    walk(c, region, scan);
                }
            }
            ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
        }
    }
    let mut scan = Scan::default();
    for root in &unit.view.roots {
        walk(root, None, &mut scan);
    }

    let cancelable = unit.semantic.methods.iter().any(|m| m.name == "_cancelExit");
    let generation = cancelable
        || unit.semantic.fields.iter().any(|f| f.name == "_motionGen")
        || unit.semantic.methods.iter().any(|m| m.name == "_enterFocus");
    let owner = unit.name.clone();
    let mut transitions = Vec::new();
    let mut next_id = 0u32;
    let overlay_token = scan.overlay_token.clone().unwrap_or_else(|| "motion.overlay".into());
    let control_token = scan.control_token.clone().unwrap_or_else(|| "motion.control".into());

    if let Some(overlay) = &scan.overlay {
        let region = scan.overlay_region;
        transitions.push(MotionTransitionDecl {
            id: next_id,
            kind: MotionTransitionKind::OverlayEnter,
            name: format!("{overlay}.overlay-enter"),
            owner: owner.clone(),
            trigger: MotionTrigger::Open,
            region,
            token: overlay_token.clone(),
            states: vec![
                MotionTransitionState::Enter,
                MotionTransitionState::Stable,
                MotionTransitionState::Cancelled,
                MotionTransitionState::Completed,
            ],
            cancelable,
            generation,
            reduced_motion: ReducedMotionPolicy::Honor,
        });
        next_id += 1;
        transitions.push(MotionTransitionDecl {
            id: next_id,
            kind: MotionTransitionKind::OverlayExit,
            name: format!("{overlay}.overlay-exit"),
            owner: owner.clone(),
            trigger: MotionTrigger::Dismiss,
            region,
            token: overlay_token,
            states: vec![
                MotionTransitionState::Exit,
                MotionTransitionState::Cancelled,
                MotionTransitionState::Completed,
            ],
            cancelable,
            generation,
            reduced_motion: ReducedMotionPolicy::Honor,
        });
        next_id += 1;
    }

    if scan.motion_kinds.iter().any(|k| k == "control") {
        transitions.push(MotionTransitionDecl {
            id: next_id,
            kind: MotionTransitionKind::Control,
            name: format!("{owner}.control"),
            owner,
            trigger: MotionTrigger::Control,
            region: None,
            token: control_token,
            states: vec![MotionTransitionState::Feedback, MotionTransitionState::Completed],
            cancelable: false,
            generation: false,
            reduced_motion: ReducedMotionPolicy::Honor,
        });
    }

    MotionView {
        status: if transitions.is_empty() { StubStatus::Empty } else { StubStatus::Partial },
        transitions,
    }
}

fn append_motion_plan_nodes(unit: &mut ProgramUnit) {
    // Rebuild is idempotent: drop prior motion_transition nodes then re-emit.
    unit.plan.nodes.retain(|n| n.kind() != PlanNodeKind::MotionTransition);
    if unit.motion.transitions.is_empty() {
        return;
    }
    let start_id = unit.plan.nodes.iter().map(|n| n.id()).max().map(|m| m + 1).unwrap_or(0);
    for (id, t) in (start_id..).zip(&unit.motion.transitions) {
        unit.plan.nodes.push(PlanNode::MotionTransition {
            id,
            region: t.region,
            tag: Some(t.name.clone()),
        });
    }
    if unit.plan.status == PlanStatus::Empty {
        unit.plan.status = PlanStatus::Partial;
    }
}

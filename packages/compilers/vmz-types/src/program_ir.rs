//! VMZ Program IR shell 鈥?unified program graph.
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
use vmz_protocol::{PLAN_SCHEMA, PROGRAM_SCHEMA, REACTIVE_SCHEMA};

/// Stable id of a [`ProgramUnit`] within one [`ProgramModule`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct UnitId {
    /// Numeric id within the module.
    pub unit_id: u32,
}

/// Authoring / deployment kind of a program unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProgramUnitKind {
    /// `.vmz` client component (may also host co-located server class edges later).
    Component,
    /// Standalone `#server` / server class module (stub until Server view fills in).
    ServerClass,
    /// Plain shared TS module (stub).
    Module,
}

impl ProgramUnitKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Component => "component",
            Self::ServerClass => "server_class",
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
    pub id: UnitId,
    pub name: String,
    pub kind: ProgramUnitKind,
    pub semantic: SemanticView,
    pub reactive: ReactiveComponent,
    pub view: ViewView,
    /// Shared Execution Plan derived from Native View (Browser/SSR/Test lowerings).
    pub plan: ExecutionPlan,
    pub resource: ResourceView,
    /// Motion transitions projected from Native View + cancel/generation contract.
    pub motion: MotionView,
    /// Lifetime regions projected from control / each / unit ownership.
    pub lifetime: LifetimeView,
    pub server: ServerView,
    pub deployment: DeploymentView,
    /// Projected reads/writes/calls + Unknown widenings (shared fact for check/explain).
    pub graph: GraphView,
}

/// Semantic symbols (fields / methods) 鈥?shared identity for other views.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct SemanticView {
    pub fields: Vec<SemanticField>,
    pub methods: Vec<SemanticMethod>,
}

/// One semantic field shared across views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SemanticField {
    /// Same numeric id as [`FieldId`] in the reactive view.
    pub id: FieldId,
    pub name: String,
    pub kind: FieldKind,
}

/// One semantic method shared across views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SemanticMethod {
    /// Same numeric id as [`EffectId`] when the method has an effect summary.
    pub id: EffectId,
    pub name: String,
    pub async_boundary: bool,
}

/// Structural / Native View 鈥?first-class query view of the unified Program Graph.
///
/// When [`ViewStatus::Native`], [`Self::roots`] is the sole structure source for
/// direct emit (`emit_direct`); TemplateIr must not be re-scanned for if/each/element.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ViewView {
    pub status: ViewStatus,
    pub binding_ids: Vec<BindingId>,
    pub region_ids: Vec<RegionId>,
    /// Structural tree (empty when [`ViewStatus::DerivedFromReactive`]).
    pub roots: Vec<ViewNode>,
}

/// Whether Native View carries a structural tree or only reactive id lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ViewStatus {
    /// Legacy ID-list projection only (no structural tree).
    #[default]
    DerivedFromReactive,
    /// Structural tree populated; emitter consumes [`ViewView::roots`].
    Native,
}

impl ViewStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DerivedFromReactive => "derived_from_reactive",
            Self::Native => "native",
        }
    }
}

/// One node in the Native View structural tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewNode {
    Text { value: String },
    Interp { expr: String, binding: Option<BindingId> },
    Element { tag: String, attrs: Vec<ViewAttr>, children: Vec<ViewNode>, each: Option<ViewEach> },
    If { region: Option<RegionId>, binding: Option<BindingId>, branches: Vec<ViewIfBranch> },
    Component { tag: String, attrs: Vec<ViewAttr>, children: Vec<ViewNode> },
    Slot { name: Option<String>, attrs: Vec<ViewAttr>, children: Vec<ViewNode> },
}

/// Attribute on a view element / component / slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewAttr {
    pub name: String,
    pub value: ViewAttrValue,
    pub binding: Option<BindingId>,
}

/// Attribute value forms in Native View.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewAttrValue {
    Static {
        value: String,
    },
    Interp {
        expr: String,
    },
    /// Present without value (e.g. `else`).
    Bare,
}

/// `each` metadata on an element.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewEach {
    pub list_expr: String,
    pub as_name: String,
    pub key_expr: Option<String>,
    pub list_binding: Option<BindingId>,
    pub key_binding: Option<BindingId>,
    /// Control / lifetime region for this each.
    pub region: Option<RegionId>,
}

/// One branch of a view `if`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ViewIfBranch {
    pub cond: Option<String>,
    pub body: Box<ViewNode>,
}

/// Thin Execution Plan 鈥?schedule derived from Native View (not a competing IR).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExecutionPlan {
    /// Wire schema id ([`PLAN_SCHEMA`]).
    pub schema: String,
    pub status: PlanStatus,
    pub root_ids: Vec<u32>,
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
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    #[default]
    Empty,
    /// Populated from Native View roots.
    Partial,
}

impl PlanStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Partial => "partial",
        }
    }
}

/// One scheduled structural node in the shared plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PlanNode {
    pub id: u32,
    /// `text` | `interp` | `element` | `if` | `each` | `component` | `slot` | `dispose_region`
    pub kind: String,
    pub binding: Option<u32>,
    pub region: Option<u32>,
    pub tag: Option<String>,
    pub children: Vec<u32>,
    /// For `if`: body plan node id per branch (same order as ViewIfBranch).
    pub branches: Vec<u32>,
}

/// Resource / async view projected from effects + server caps.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ResourceView {
    pub status: StubStatus,
    pub resources: Vec<ResourceDecl>,
}

/// One async / server resource owned by this unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ResourceDecl {
    pub id: u32,
    /// `async_task` | `server_capability` | `http`
    pub kind: String,
    pub name: String,
    /// Owning client method / effect when known.
    pub owner: Option<String>,
    /// AsyncTask protocol states; empty for non-task resources.
    pub states: Vec<String>,
    pub cancelable: bool,
    /// Generation / supersede protocol (same as runtime `__vmzRunTask`).
    pub generation: bool,
}

/// Motion view 鈥?Program Graph projection of UI transitions.
///
/// Not a second animation runtime: facts only (owner, trigger, region, cancel, generation).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct MotionView {
    pub status: StubStatus,
    pub transitions: Vec<MotionTransitionDecl>,
}

/// One motion transition owned by this unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct MotionTransitionDecl {
    pub id: u32,
    /// `overlay-enter` | `overlay-exit` | `control`
    pub kind: String,
    pub name: String,
    /// Owning unit / surface name.
    pub owner: String,
    /// Trigger event / method / prop (`open` | `dismiss` | `control`).
    pub trigger: String,
    /// Reachable LifetimeRegion when known (overlay inside `if`).
    pub region: Option<u32>,
    /// Style Theme token family (`motion.overlay` | `motion.control`).
    pub token: String,
    /// enter | exit | stable | cancelled | completed (subset by kind).
    pub states: Vec<String>,
    pub cancelable: bool,
    pub generation: bool,
    /// `honor` = prefers-reduced-motion changes presentation, not final state.
    pub reduced_motion: String,
}

/// Lifetime / ownership projection 鈥?not a competing IR.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct LifetimeView {
    pub status: StubStatus,
    pub regions: Vec<LifetimeRegionDecl>,
}

/// One LifetimeRegion on the Program Graph (shares RegionId with control/each).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LifetimeRegionDecl {
    pub id: u32,
    /// `if` | `each` | `ternary` | `unknown`
    pub kind: String,
    /// Owning unit name (component is author boundary; region is execute boundary).
    pub owner_unit: String,
}

/// First-class graph edges + Unknown provenance.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct GraphView {
    pub status: StubStatus,
    pub edges: Vec<ProgramEdge>,
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

/// One directed Program Graph edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProgramEdge {
    /// `reads` | `writes` | `calls` | `region_stable` | `owns` | `disposes` | `spawns` | `cancels` | `affects`
    pub kind: String,
    pub from: String,
    pub to: String,
}

/// Provenance for an Unknown path widening.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct UnknownRecord {
    pub field: String,
    pub reason: String,
    pub via: String,
}

/// Server capability view 鈥?co-located `#server` / server class surface.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct ServerView {
    pub status: StubStatus,
    /// Virtual module id, e.g. `#server/components/UserCard`.
    pub module_id: Option<String>,
    pub class_name: Option<String>,
    pub capabilities: Vec<ServerCapability>,
    /// Proven client -> capability call edges (static surface match; not full CFG yet).
    pub calls: Vec<ServerCallEdge>,
    /// Compiler-known secret bindings (names only 鈥?never values).
    pub secret_requirements: Vec<SecretRequirement>,
    /// True when this server slice has no secret requirements (browser-safe placement).
    pub browser_safe: bool,
}

/// One `SecretRequirement` fact projected from `#server/secrets` / `secret('NAME')`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SecretRequirement {
    /// Environment binding name (`PAYMENTS_API_KEY`) 鈥?not a value.
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
    pub id: CapabilityId,
    pub method: String,
    pub async_boundary: bool,
    pub is_private: bool,
    /// Non-private methods are callable from client stubs (RPC surface).
    pub callable_from_client: bool,
    pub http: Option<HttpRoute>,
}

/// Proven client -> capability call edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ServerCallEdge {
    pub capability: CapabilityId,
    pub method: String,
    /// Client method / effect name when known (e.g. `onMount`).
    pub from_client_method: Option<String>,
}

/// Proven client -> server method call (filled by compiler oxc walk).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ClientServerCall {
    pub server_method: String,
    pub from_client_method: Option<String>,
}

/// Input for attaching a co-located server class onto a component unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerAttach {
    pub module_id: String,
    pub class_name: String,
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
    pub status: StubStatus,
    /// `app` | `page` | `component` | `other`
    pub unit_kind: Option<String>,
    /// Stable chunk id within the project (posix-style relative stem).
    pub chunk_id: Option<String>,
    /// Client JS entry relative to out_dir.
    pub client_entry: Option<String>,
    /// Program IR path relative to out_dir.
    pub program_ir: Option<String>,
    /// Control region ids projected from the Reactive / View layer.
    pub region_ids: Vec<u32>,
    /// Server capability method names owned by this unit.
    pub capabilities: Vec<String>,
    /// Virtual `#server/...` module id when co-located server exists.
    pub server_module_id: Option<String>,
    /// Client method -> server capability edges.
    pub client_calls: Vec<DeploymentClientCall>,
    /// Island / ResumeEntry products derived from View `client:*` (resume).
    pub resume_entries: Vec<ResumeEntryDecl>,
}

/// One Island resume product (SSR slice + client attach). Same Plan identity as Browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResumeEntryDecl {
    pub component: String,
    /// `idle` | `load` | `visible` | ...
    pub strategy: String,
    pub state_keys: Vec<String>,
    pub prop_keys: Vec<String>,
    /// Plan root ids of the island component unit when known; else empty.
    pub plan_root_ids: Vec<u32>,
}

/// Stub population status for projected views.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StubStatus {
    #[default]
    Empty,
    Partial,
}

impl StubStatus {
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

    /// Pretty-printed `*.program.json` via serde (no ad-hoc Value builders).
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
                            strategy =
                                Some(if s.is_empty() { "load".into() } else { s.to_string() });
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
            binding_ids: reactive.bindings.iter().map(|b| b.id).collect(),
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
                // AsyncTask enters the graph (13 ): pending/success/error/cancelled + cancel/generation.
                resources.push(ResourceDecl {
                    id: next_res,
                    kind: "async_task".into(),
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
            let kind = if c.http.is_some() { "http" } else { "server_capability" };
            resources.push(ResourceDecl {
                id: next_res,
                kind: kind.into(),
                name: c.method.clone(),
                owner: self.server.class_name.clone(),
                states: Vec::new(),
                cancelable: false,
                generation: false,
            });
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
        let mut kind_by_region: std::collections::BTreeMap<u32, String> =
            std::collections::BTreeMap::new();
        fn walk_lifetime_kinds(node: &ViewNode, map: &mut std::collections::BTreeMap<u32, String>) {
            match node {
                ViewNode::If { region, branches, .. } => {
                    if let Some(r) = region {
                        map.entry(r.0).or_insert_with(|| "if".into());
                    }
                    for b in branches {
                        walk_lifetime_kinds(&b.body, map);
                    }
                }
                ViewNode::Element { children, each, .. } => {
                    if let Some(e) = each {
                        if let Some(r) = e.region {
                            map.entry(r.0).or_insert_with(|| "each".into());
                        }
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
            let kind = kind_by_region.get(&r.id.0).cloned().unwrap_or_else(|| "unknown".into());
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
            let via = format!("binding:{}", b.id.0);
            for r in &b.reads {
                let path = r.to_stable_string(fields, props, exprs);
                edges.push(ProgramEdge {
                    kind: "reads".into(),
                    from: via.clone(),
                    to: path.clone(),
                });
                if let IrDepPath::Unknown(id) = r {
                    let field = fields
                        .iter()
                        .find(|s| s.id == *id)
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
                edges.push(ProgramEdge { kind: "reads".into(), from: via.clone(), to: path });
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
                    kind: "writes".into(),
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
                    kind: "calls".into(),
                    from: via.clone(),
                    to: format!("method:{callee}"),
                });
            }
        }
        for r in &self.reactive.control_regions {
            let via = format!("region:{}", r.id.0);
            for p in &r.stable {
                edges.push(ProgramEdge {
                    kind: "region_stable".into(),
                    from: via.clone(),
                    to: p.to_stable_string(fields, props, exprs),
                });
            }
        }
        // ownership edges: unit owns lifetime regions; regions/unit dispose resources.
        let unit_from = format!("unit:{}", self.name);
        for lr in &self.lifetime.regions {
            edges.push(ProgramEdge {
                kind: "owns".into(),
                from: unit_from.clone(),
                to: format!("region:{}", lr.id),
            });
        }
        for res in &self.resource.resources {
            edges.push(ProgramEdge {
                kind: "disposes".into(),
                from: unit_from.clone(),
                to: format!("resource:{}", res.id),
            });
            // Regions share unit dispose of resources until finer ownership analysis.
            for lr in &self.lifetime.regions {
                edges.push(ProgramEdge {
                    kind: "disposes".into(),
                    from: format!("region:{}", lr.id),
                    to: format!("resource:{}", res.id),
                });
            }
            if res.kind == "async_task" {
                let task = format!("task:{}", res.id);
                edges.push(ProgramEdge {
                    kind: "cancels".into(),
                    from: "lifecycle:destroy".into(),
                    to: task.clone(),
                });
                edges.push(ProgramEdge {
                    kind: "cancels".into(),
                    from: unit_from.clone(),
                    to: task.clone(),
                });
                if let Some(owner) = &res.owner {
                    edges.push(ProgramEdge {
                        kind: "spawns".into(),
                        from: format!("effect:{owner}"),
                        to: task,
                    });
                }
            }
        }
        for t in &self.motion.transitions {
            let motion = format!("motion:{}", t.id);
            edges.push(ProgramEdge {
                kind: "owns".into(),
                from: unit_from.clone(),
                to: motion.clone(),
            });
            edges.push(ProgramEdge {
                kind: "spawns".into(),
                from: format!("trigger:{}", t.trigger),
                to: motion.clone(),
            });
            if let Some(region) = t.region {
                // Region fine edge: transition is confined to a LifetimeRegion.
                edges.push(ProgramEdge {
                    kind: "affects".into(),
                    from: motion.clone(),
                    to: format!("region:{region}"),
                });
            }
            if t.cancelable {
                edges.push(ProgramEdge {
                    kind: "cancels".into(),
                    from: "lifecycle:destroy".into(),
                    to: motion.clone(),
                });
                edges.push(ProgramEdge {
                    kind: "cancels".into(),
                    from: "motion:reverse".into(),
                    to: motion.clone(),
                });
                if self.semantic.methods.iter().any(|m| m.name == "_cancelExit") {
                    edges.push(ProgramEdge {
                        kind: "cancels".into(),
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
                kind: "calls".into(),
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
                if let Some(e) = each {
                    if let Some(r) = e.region {
                        next_region = Some(r.0);
                    }
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
                    if v == "control" {
                        if let Some(tok) = &token_here {
                            scan.control_token = Some(tok.clone());
                        }
                    }
                    // Overlay enter/exit markers may carry token on the motion element itself.
                    if (v == "overlay-enter" || v == "overlay-exit") && scan.overlay_token.is_none()
                    {
                        if let Some(tok) = &token_here {
                            scan.overlay_token = Some(tok.clone());
                        }
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
            kind: "overlay-enter".into(),
            name: format!("{overlay}.overlay-enter"),
            owner: owner.clone(),
            trigger: "open".into(),
            region,
            token: overlay_token.clone(),
            states: vec!["enter".into(), "stable".into(), "cancelled".into(), "completed".into()],
            cancelable,
            generation,
            reduced_motion: "honor".into(),
        });
        next_id += 1;
        transitions.push(MotionTransitionDecl {
            id: next_id,
            kind: "overlay-exit".into(),
            name: format!("{overlay}.overlay-exit"),
            owner: owner.clone(),
            trigger: "dismiss".into(),
            region,
            token: overlay_token,
            states: vec!["exit".into(), "cancelled".into(), "completed".into()],
            cancelable,
            generation,
            reduced_motion: "honor".into(),
        });
        next_id += 1;
    }

    if scan.motion_kinds.iter().any(|k| k == "control") {
        transitions.push(MotionTransitionDecl {
            id: next_id,
            kind: "control".into(),
            name: format!("{owner}.control"),
            owner,
            trigger: "control".into(),
            region: None,
            token: control_token,
            states: vec!["feedback".into(), "completed".into()],
            cancelable: false,
            generation: false,
            reduced_motion: "honor".into(),
        });
    }

    MotionView {
        status: if transitions.is_empty() { StubStatus::Empty } else { StubStatus::Partial },
        transitions,
    }
}

fn append_motion_plan_nodes(unit: &mut ProgramUnit) {
    // Rebuild is idempotent: drop prior motion_transition nodes then re-emit.
    unit.plan.nodes.retain(|n| n.kind != "motion_transition");
    if unit.motion.transitions.is_empty() {
        return;
    }
    let mut next_id = unit.plan.nodes.iter().map(|n| n.id).max().map(|m| m + 1).unwrap_or(0);
    for t in &unit.motion.transitions {
        unit.plan.nodes.push(PlanNode {
            id: next_id,
            kind: "motion_transition".into(),
            binding: None,
            region: t.region,
            tag: Some(t.name.clone()),
            children: Vec::new(),
            branches: Vec::new(),
        });
        next_id += 1;
    }
    if unit.plan.status == PlanStatus::Empty {
        unit.plan.status = PlanStatus::Partial;
    }
}

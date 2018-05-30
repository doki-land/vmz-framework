//! VMZ Program IR shell — unified program graph.
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
use vmz_protocol::{PLAN_SCHEMA, PROGRAM_SCHEMA};

/// Stable id of a [`ProgramUnit`] within one [`ProgramModule`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UnitId(pub u32);

/// Authoring / deployment kind of a program unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramModule {
    pub source: String,
    pub units: Vec<ProgramUnit>,
}

/// One compilable unit with layered views sharing field/binding ids.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramUnit {
    pub id: UnitId,
    pub name: String,
    pub kind: ProgramUnitKind,
    pub semantic: SemanticView,
    pub reactive: ReactiveComponent,
    pub view: ViewView,
    // Shared Execution Plan derived from Native View — Browser/SSR/Test lowerings.
    pub plan: ExecutionPlan,
    pub resource: ResourceView,
    // Lifetime regions projected from control / each / unit ownership .
    pub lifetime: LifetimeView,
    pub server: ServerView,
    pub deployment: DeploymentView,
    /// Projected reads/writes/calls + Unknown widenings (shared fact for check/explain).
    pub graph: GraphView,
}

/// Semantic symbols (fields / methods) — shared identity for other views.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SemanticView {
    pub fields: Vec<SemanticField>,
    pub methods: Vec<SemanticMethod>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticField {
    /// Same numeric id as [`FieldId`] in the reactive view.
    pub id: FieldId,
    pub name: String,
    pub kind: FieldKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticMethod {
    /// Same numeric id as [`EffectId`] when the method has an effect summary.
    pub id: EffectId,
    pub name: String,
    pub async_boundary: bool,
}

// Structural / Native View — first-class query view of the unified Program Graph .
///
/// When [`ViewStatus::Native`], [`Self::roots`] is the sole structure source for
/// direct emit (`emit_direct`); TemplateIr must not be re-scanned for if/each/element.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ViewView {
    pub status: ViewStatus,
    pub binding_ids: Vec<BindingId>,
    pub region_ids: Vec<RegionId>,
    /// Structural tree (empty when [`ViewStatus::DerivedFromReactive`]).
    pub roots: Vec<ViewNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewNode {
    Text(String),
    Interp { expr: String, binding: Option<BindingId> },
    Element { tag: String, attrs: Vec<ViewAttr>, children: Vec<ViewNode>, each: Option<ViewEach> },
    If { region: Option<RegionId>, binding: Option<BindingId>, branches: Vec<ViewIfBranch> },
    Component { tag: String, attrs: Vec<ViewAttr>, children: Vec<ViewNode> },
    Slot { name: Option<String>, attrs: Vec<ViewAttr>, children: Vec<ViewNode> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewAttr {
    pub name: String,
    pub value: ViewAttrValue,
    pub binding: Option<BindingId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewAttrValue {
    Static(String),
    Interp(String),
    /// Present without value (e.g. `else`).
    Bare,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewEach {
    pub list_expr: String,
    pub as_name: String,
    pub key_expr: Option<String>,
    pub list_binding: Option<BindingId>,
    pub key_binding: Option<BindingId>,
    // Control / lifetime region for this each .
    pub region: Option<RegionId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewIfBranch {
    pub cond: Option<String>,
    pub body: Box<ViewNode>,
}

/// Thin Execution Plan — schedule derived from Native View (not a competing IR).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExecutionPlan {
    pub status: PlanStatus,
    pub root_ids: Vec<u32>,
    pub nodes: Vec<PlanNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
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

/// Resource / async view (Program IR A — projected from effects + server caps).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ResourceView {
    pub status: StubStatus,
    pub resources: Vec<ResourceDecl>,
}

/// One async / server resource owned by this unit (skeleton → AsyncTask surface).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceDecl {
    pub id: u32,
    /// `async_task` | `server_capability` | `http`
    pub kind: String,
    pub name: String,
    /// Owning client method / effect when known.
    pub owner: Option<String>,
    /// AsyncTask protocol states (13 ); empty for non-task resources.
    pub states: Vec<String>,
    pub cancelable: bool,
    /// Generation / supersede protocol (same as runtime `__vmzRunTask`).
    pub generation: bool,
}

// Lifetime / ownership projection — not a competing IR.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LifetimeView {
    pub status: StubStatus,
    pub regions: Vec<LifetimeRegionDecl>,
}

/// One LifetimeRegion on the Program Graph (shares RegionId with control/each).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifetimeRegionDecl {
    pub id: u32,
    /// `if` | `each` | `ternary` | `unknown`
    pub kind: String,
    /// Owning unit name (component is author boundary; region is execute boundary).
    pub owner_unit: String,
}

/// First-class graph edges + Unknown provenance (Program IR A).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GraphView {
    pub status: StubStatus,
    pub edges: Vec<ProgramEdge>,
    pub unknowns: Vec<UnknownRecord>,
    /// Stage 02 analysis closed-loop metrics.
    pub analysis: AnalysisStats,
}

/// Binding / effect path precision counts for analysis progress.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AnalysisStats {
    /// Field / StaticPath / DynamicPath / ListItem reads+writes.
    pub exact: u32,
    /// Unknown with a specific widen reason (opaque / destructure / closure…).
    pub widened: u32,
    /// Unknown with only generic `field_star` provenance.
    pub unknown: u32,
    /// `calls` edges on effects.
    pub call_edges: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramEdge {
    /// `reads` | `writes` | `calls` | `region_stable` | `owns` | `disposes` | `spawns` | `cancels`
    pub kind: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownRecord {
    pub field: String,
    pub reason: String,
    pub via: String,
}

/// Server capability view — co-located `#server` / server class surface.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerView {
    pub status: StubStatus,
    /// Virtual module id, e.g. `#server/components/UserCard`.
    pub module_id: Option<String>,
    pub class_name: Option<String>,
    pub capabilities: Vec<ServerCapability>,
    /// Proven client → capability call edges (static surface match; not full CFG yet).
    pub calls: Vec<ServerCallEdge>,
}

/// Stable id of a server capability within one [`ProgramUnit`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CapabilityId(pub u32);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerCapability {
    pub id: CapabilityId,
    pub method: String,
    pub async_boundary: bool,
    pub is_private: bool,
    /// Non-private methods are callable from client stubs (RPC surface).
    pub callable_from_client: bool,
    pub http: Option<HttpRoute>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerCallEdge {
    pub capability: CapabilityId,
    pub method: String,
    /// Client method / effect name when known (e.g. `onMount`).
    pub from_client_method: Option<String>,
}

/// Proven client → server method call (filled by compiler oxc walk).
#[derive(Debug, Clone, PartialEq, Eq)]
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
}

/// Deployment / Island / chunk view (deployment / island / chunk).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
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
    /// Client method → server capability edges (method names).
    pub client_calls: Vec<(String, Option<String>)>,
    /// Island / ResumeEntry products derived from View `client:*` (resume) — not a Resume IR.
    pub resume_entries: Vec<ResumeEntryDecl>,
}

/// One Island resume product (SSR slice + client attach). Same Plan identity as Browser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeEntryDecl {
    pub component: String,
    /// `idle` | `load` | `visible` | …
    pub strategy: String,
    pub state_keys: Vec<String>,
    pub prop_keys: Vec<String>,
    /// Plan root ids of the *island component unit* when known; else empty.
    pub plan_root_ids: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
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
            .map(|(i, c)| ProgramUnit::from_reactive_component(UnitId(i as u32), c))
            .collect();
        Self { source: module.source, units }
    }

    /// Project back to transitional [`ReactiveModule`] (tests / `*.reactive.json`).
    pub fn to_reactive_module(&self) -> ReactiveModule {
        ReactiveModule {
            source: self.source.clone(),
            components: self.units.iter().map(|u| u.reactive.clone()).collect(),
        }
    }

    pub fn to_json(&self) -> String {
        let mut out = String::new();
        out.push_str("{\n");
        out.push_str(&format!("  \"schema\": {:?},\n", PROGRAM_SCHEMA));
        out.push_str(&format!("  \"source\": {:?},\n", self.source));
        out.push_str("  \"units\": [\n");
        for (i, u) in self.units.iter().enumerate() {
            if i > 0 {
                out.push_str(",\n");
            }
            out.push_str(&unit_json(u, "    "));
        }
        out.push_str("\n  ]\n}\n");
        out
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
                ViewNode::Text(_) | ViewNode::Interp { .. } => {}
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

        self.server = ServerView {
            status: if capabilities.is_empty() { StubStatus::Empty } else { StubStatus::Partial },
            module_id: Some(attach.module_id.clone()),
            class_name: Some(attach.class_name.clone()),
            capabilities,
            calls,
        };
        self.rebuild_projected_views();
    }

    /// Recompute resource + graph projections from reactive / server views.
    pub fn rebuild_projected_views(&mut self) {
        let fields = &self.reactive.state_slots;
        let props = &self.reactive.properties;
        let exprs = &self.reactive.exprs;

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
                ViewNode::Text(_) | ViewNode::Interp { .. } => {}
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

fn unit_json(u: &ProgramUnit, indent: &str) -> String {
    let ind2 = format!("{indent}  ");
    let ind3 = format!("{indent}    ");
    let mut s = String::new();
    s.push_str(&format!("{indent}{{\n"));
    s.push_str(&format!("{ind2}\"id\": {},\n", u.id.0));
    s.push_str(&format!("{ind2}\"name\": {:?},\n", u.name));
    s.push_str(&format!("{ind2}\"kind\": {:?},\n", u.kind.as_str()));

    s.push_str(&format!("{ind2}\"semantic\": {{\n"));
    s.push_str(&format!("{ind3}\"fields\": [\n"));
    for (i, f) in u.semantic.fields.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let kind = match f.kind {
            FieldKind::Prop => "prop",
            FieldKind::State => "state",
        };
        s.push_str(&format!(
            "{ind3}  {{ \"id\": {}, \"name\": {:?}, \"kind\": {:?} }}",
            f.id.0, f.name, kind
        ));
    }
    s.push_str(&format!("\n{ind3}],\n"));
    s.push_str(&format!("{ind3}\"methods\": [\n"));
    for (i, m) in u.semantic.methods.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        s.push_str(&format!(
            "{ind3}  {{ \"id\": {}, \"name\": {:?}, \"async_boundary\": {} }}",
            m.id.0, m.name, m.async_boundary
        ));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"reactive\": "));
    s.push_str(&crate::reactive_ir::reactive_component_json(&u.reactive, &ind2));
    s.push_str(",\n");

    s.push_str(&format!("{ind2}\"view\": {{\n"));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.view.status.as_str()));
    let bids: Vec<String> = u.view.binding_ids.iter().map(|id| id.0.to_string()).collect();
    let rids: Vec<String> = u.view.region_ids.iter().map(|id| id.0.to_string()).collect();
    s.push_str(&format!("{ind3}\"binding_ids\": [{}],\n", bids.join(", ")));
    s.push_str(&format!("{ind3}\"region_ids\": [{}],\n", rids.join(", ")));
    s.push_str(&format!("{ind3}\"roots\": [\n"));
    for (i, n) in u.view.roots.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        s.push_str(&view_node_json(n, &format!("{ind3}  ")));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"plan\": {{\n"));
    s.push_str(&format!("{ind3}\"schema\": {:?},\n", PLAN_SCHEMA));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.plan.status.as_str()));
    let root_ids: Vec<String> = u.plan.root_ids.iter().map(|id| id.to_string()).collect();
    s.push_str(&format!("{ind3}\"root_ids\": [{}],\n", root_ids.join(", ")));
    s.push_str(&format!("{ind3}\"nodes\": [\n"));
    for (i, n) in u.plan.nodes.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let binding = n.binding.map(|b| b.to_string()).unwrap_or_else(|| "null".into());
        let region = n.region.map(|r| r.to_string()).unwrap_or_else(|| "null".into());
        let tag = match &n.tag {
            Some(t) => format!("{t:?}"),
            None => "null".into(),
        };
        let kids: Vec<String> = n.children.iter().map(|c| c.to_string()).collect();
        let brs: Vec<String> = n.branches.iter().map(|c| c.to_string()).collect();
        s.push_str(&format!(
            "{ind3}  {{ \"id\": {}, \"kind\": {:?}, \"binding\": {binding}, \"region\": {region}, \"tag\": {tag}, \"children\": [{}], \"branches\": [{}] }}",
            n.id,
            n.kind,
            kids.join(", "),
            brs.join(", ")
        ));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"resource\": {{\n"));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.resource.status.as_str()));
    s.push_str(&format!("{ind3}\"resources\": [\n"));
    for (i, r) in u.resource.resources.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let owner = match &r.owner {
            Some(o) => format!("{o:?}"),
            None => "null".into(),
        };
        let states: Vec<String> = r.states.iter().map(|s| format!("{s:?}")).collect();
        s.push_str(&format!(
            "{ind3}  {{ \"id\": {}, \"kind\": {:?}, \"name\": {:?}, \"owner\": {owner}, \"states\": [{}], \"cancelable\": {}, \"generation\": {} }}",
            r.id,
            r.kind,
            r.name,
            states.join(", "),
            r.cancelable,
            r.generation
        ));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"lifetime\": {{\n"));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.lifetime.status.as_str()));
    s.push_str(&format!("{ind3}\"regions\": [\n"));
    for (i, r) in u.lifetime.regions.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        s.push_str(&format!(
            "{ind3}  {{ \"id\": {}, \"kind\": {:?}, \"owner_unit\": {:?} }}",
            r.id, r.kind, r.owner_unit
        ));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"graph\": {{\n"));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.graph.status.as_str()));
    s.push_str(&format!("{ind3}\"edges\": [\n"));
    for (i, e) in u.graph.edges.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        s.push_str(&format!(
            "{ind3}  {{ \"kind\": {:?}, \"from\": {:?}, \"to\": {:?} }}",
            e.kind, e.from, e.to
        ));
    }
    s.push_str(&format!("\n{ind3}],\n"));
    s.push_str(&format!("{ind3}\"unknowns\": [\n"));
    for (i, uq) in u.graph.unknowns.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        s.push_str(&format!(
            "{ind3}  {{ \"field\": {:?}, \"reason\": {:?}, \"via\": {:?} }}",
            uq.field, uq.reason, uq.via
        ));
    }
    s.push_str(&format!("\n{ind3}],\n"));
    s.push_str(&format!(
        "{ind3}\"analysis\": {{ \"exact\": {}, \"widened\": {}, \"unknown\": {}, \"call_edges\": {} }}\n",
        u.graph.analysis.exact,
        u.graph.analysis.widened,
        u.graph.analysis.unknown,
        u.graph.analysis.call_edges
    ));
    s.push_str(&format!("{ind2}}},\n"));

    s.push_str(&format!("{ind2}\"server\": "));
    s.push_str(&server_json(&u.server, &ind2));
    s.push_str(",\n");
    s.push_str(&format!("{ind2}\"deployment\": {{\n"));
    s.push_str(&format!("{ind3}\"status\": {:?},\n", u.deployment.status.as_str()));
    s.push_str(&format!(
        "{ind3}\"unitKind\": {},\n",
        opt_json_str(u.deployment.unit_kind.as_deref())
    ));
    s.push_str(&format!(
        "{ind3}\"chunkId\": {},\n",
        opt_json_str(u.deployment.chunk_id.as_deref())
    ));
    s.push_str(&format!(
        "{ind3}\"clientEntry\": {},\n",
        opt_json_str(u.deployment.client_entry.as_deref())
    ));
    s.push_str(&format!(
        "{ind3}\"programIr\": {},\n",
        opt_json_str(u.deployment.program_ir.as_deref())
    ));
    let region_ids: Vec<String> = u.deployment.region_ids.iter().map(|id| id.to_string()).collect();
    s.push_str(&format!("{ind3}\"regionIds\": [{}],\n", region_ids.join(", ")));
    let caps: Vec<String> = u.deployment.capabilities.iter().map(|c| format!("{c:?}")).collect();
    s.push_str(&format!("{ind3}\"capabilities\": [{}],\n", caps.join(", ")));
    s.push_str(&format!(
        "{ind3}\"serverModuleId\": {},\n",
        opt_json_str(u.deployment.server_module_id.as_deref())
    ));
    s.push_str(&format!("{ind3}\"clientCalls\": [\n"));
    for (i, (method, from)) in u.deployment.client_calls.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let from_s = match from {
            Some(f) => format!("{f:?}"),
            None => "null".into(),
        };
        s.push_str(&format!(
            "{ind3}  {{ \"method\": {method:?}, \"fromClientMethod\": {from_s} }}"
        ));
    }
    s.push_str(&format!("\n{ind3}],\n"));
    s.push_str(&format!("{ind3}\"resumeEntries\": [\n"));
    for (i, e) in u.deployment.resume_entries.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let sk: Vec<String> = e.state_keys.iter().map(|k| format!("{k:?}")).collect();
        let pk: Vec<String> = e.prop_keys.iter().map(|k| format!("{k:?}")).collect();
        let roots: Vec<String> = e.plan_root_ids.iter().map(|id| id.to_string()).collect();
        s.push_str(&format!(
            "{ind3}  {{ \"component\": {:?}, \"strategy\": {:?}, \"stateKeys\": [{}], \"propKeys\": [{}], \"planRootIds\": [{}] }}",
            e.component,
            e.strategy,
            sk.join(", "),
            pk.join(", "),
            roots.join(", ")
        ));
    }
    s.push_str(&format!("\n{ind3}]\n"));
    s.push_str(&format!("{ind2}}}\n"));
    s.push_str(&format!("{indent}}}"));
    s
}

fn view_node_json(n: &ViewNode, indent: &str) -> String {
    let ind2 = format!("{indent}  ");
    match n {
        ViewNode::Text(t) => format!("{indent}{{ \"kind\": \"text\", \"value\": {t:?} }}"),
        ViewNode::Interp { expr, binding } => {
            let bid = binding.map(|b| b.0.to_string()).unwrap_or_else(|| "null".into());
            format!("{indent}{{ \"kind\": \"interp\", \"expr\": {expr:?}, \"binding\": {bid} }}")
        }
        ViewNode::Element { tag, attrs, children, each } => {
            let mut s = String::new();
            s.push_str(&format!("{indent}{{\n"));
            s.push_str(&format!("{ind2}\"kind\": \"element\",\n"));
            s.push_str(&format!("{ind2}\"tag\": {tag:?},\n"));
            s.push_str(&format!("{ind2}\"attrs\": [\n"));
            for (i, a) in attrs.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_attr_json(a, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}],\n"));
            match each {
                Some(e) => {
                    let list_b =
                        e.list_binding.map(|b| b.0.to_string()).unwrap_or_else(|| "null".into());
                    let key_b =
                        e.key_binding.map(|b| b.0.to_string()).unwrap_or_else(|| "null".into());
                    let key = match &e.key_expr {
                        Some(k) => format!("{k:?}"),
                        None => "null".into(),
                    };
                    let region = e.region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
                    s.push_str(&format!(
                        "{ind2}\"each\": {{ \"list\": {:?}, \"as\": {:?}, \"key\": {key}, \"listBinding\": {list_b}, \"keyBinding\": {key_b}, \"region\": {region} }},\n",
                        e.list_expr, e.as_name
                    ));
                }
                None => s.push_str(&format!("{ind2}\"each\": null,\n")),
            }
            s.push_str(&format!("{ind2}\"children\": [\n"));
            for (i, c) in children.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_node_json(c, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}]\n"));
            s.push_str(&format!("{indent}}}"));
            s
        }
        ViewNode::If { region, binding, branches } => {
            let rid = region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
            let bid = binding.map(|b| b.0.to_string()).unwrap_or_else(|| "null".into());
            let mut s = String::new();
            s.push_str(&format!("{indent}{{\n"));
            s.push_str(&format!("{ind2}\"kind\": \"if\",\n"));
            s.push_str(&format!("{ind2}\"region\": {rid},\n"));
            s.push_str(&format!("{ind2}\"binding\": {bid},\n"));
            s.push_str(&format!("{ind2}\"branches\": [\n"));
            for (i, br) in branches.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                let cond = match &br.cond {
                    Some(c) => format!("{c:?}"),
                    None => "null".into(),
                };
                s.push_str(&format!("{ind2}  {{\n"));
                s.push_str(&format!("{ind2}    \"cond\": {cond},\n"));
                s.push_str(&format!("{ind2}    \"body\": "));
                s.push_str(&view_node_json(&br.body, &format!("{ind2}    ")));
                s.push_str(&format!("\n{ind2}  }}"));
            }
            s.push_str(&format!("\n{ind2}]\n"));
            s.push_str(&format!("{indent}}}"));
            s
        }
        ViewNode::Component { tag, attrs, children } => {
            let mut s = String::new();
            s.push_str(&format!("{indent}{{\n"));
            s.push_str(&format!("{ind2}\"kind\": \"component\",\n"));
            s.push_str(&format!("{ind2}\"tag\": {tag:?},\n"));
            s.push_str(&format!("{ind2}\"attrs\": [\n"));
            for (i, a) in attrs.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_attr_json(a, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}],\n"));
            s.push_str(&format!("{ind2}\"children\": [\n"));
            for (i, c) in children.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_node_json(c, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}]\n"));
            s.push_str(&format!("{indent}}}"));
            s
        }
        ViewNode::Slot { name, attrs, children } => {
            let name_s = match name {
                Some(n) => format!("{n:?}"),
                None => "null".into(),
            };
            let mut s = String::new();
            s.push_str(&format!("{indent}{{\n"));
            s.push_str(&format!("{ind2}\"kind\": \"slot\",\n"));
            s.push_str(&format!("{ind2}\"name\": {name_s},\n"));
            s.push_str(&format!("{ind2}\"attrs\": [\n"));
            for (i, a) in attrs.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_attr_json(a, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}],\n"));
            s.push_str(&format!("{ind2}\"children\": [\n"));
            for (i, c) in children.iter().enumerate() {
                if i > 0 {
                    s.push_str(",\n");
                }
                s.push_str(&view_node_json(c, &format!("{ind2}  ")));
            }
            s.push_str(&format!("\n{ind2}]\n"));
            s.push_str(&format!("{indent}}}"));
            s
        }
    }
}

fn view_attr_json(a: &ViewAttr, indent: &str) -> String {
    let bid = a.binding.map(|b| b.0.to_string()).unwrap_or_else(|| "null".into());
    match &a.value {
        ViewAttrValue::Static(v) => format!(
            "{indent}{{ \"name\": {:?}, \"value\": {{ \"kind\": \"static\", \"text\": {v:?} }}, \"binding\": {bid} }}",
            a.name
        ),
        ViewAttrValue::Interp(e) => format!(
            "{indent}{{ \"name\": {:?}, \"value\": {{ \"kind\": \"interp\", \"expr\": {e:?} }}, \"binding\": {bid} }}",
            a.name
        ),
        ViewAttrValue::Bare => format!(
            "{indent}{{ \"name\": {:?}, \"value\": {{ \"kind\": \"bare\" }}, \"binding\": {bid} }}",
            a.name
        ),
    }
}

fn opt_json_str(v: Option<&str>) -> String {
    match v {
        Some(s) => format!("{s:?}"),
        None => "null".into(),
    }
}

fn server_json(server: &ServerView, indent: &str) -> String {
    let ind2 = format!("{indent}  ");
    let mut s = String::new();
    s.push_str("{\n");
    s.push_str(&format!("{ind2}\"status\": {:?},\n", server.status.as_str()));
    match &server.module_id {
        Some(id) => s.push_str(&format!("{ind2}\"module_id\": {:?},\n", id)),
        None => s.push_str(&format!("{ind2}\"module_id\": null,\n")),
    }
    match &server.class_name {
        Some(name) => s.push_str(&format!("{ind2}\"class_name\": {:?},\n", name)),
        None => s.push_str(&format!("{ind2}\"class_name\": null,\n")),
    }
    s.push_str(&format!("{ind2}\"capabilities\": [\n"));
    for (i, c) in server.capabilities.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let http = match &c.http {
            Some(h) => format!("{{ \"verb\": {:?}, \"path\": {:?} }}", h.verb, h.path),
            None => "null".into(),
        };
        s.push_str(&format!(
            "{ind2}  {{ \"id\": {}, \"method\": {:?}, \"async_boundary\": {}, \"is_private\": {}, \"callable_from_client\": {}, \"http\": {} }}",
            c.id.0,
            c.method,
            c.async_boundary,
            c.is_private,
            c.callable_from_client,
            http
        ));
    }
    s.push_str(&format!("\n{ind2}],\n"));
    s.push_str(&format!("{ind2}\"calls\": [\n"));
    for (i, edge) in server.calls.iter().enumerate() {
        if i > 0 {
            s.push_str(",\n");
        }
        let from = match &edge.from_client_method {
            Some(m) => format!("{:?}", m),
            None => "null".into(),
        };
        s.push_str(&format!(
            "{ind2}  {{ \"capability\": {}, \"method\": {:?}, \"from_client_method\": {} }}",
            edge.capability.0, edge.method, from
        ));
    }
    s.push_str(&format!("\n{ind2}]\n"));
    s.push_str(&format!("{indent}}}"));
    s
}

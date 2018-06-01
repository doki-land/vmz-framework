//! Reactive view of the VMZ Program Graph.
//!
//! [`ReactiveModule`] is **not** the long-term sole IR — it is the Reactive view
//! lifted into [`crate::program_ir::ProgramModule`]. Still emits
//! `*.reactive.json` for path precision; `*.program.json` is the expanding shell.
//! String `deps` in blueprints remain a transitional adapter.

use crate::FieldKind;
use crate::dep_key::{DepKey, PathSegment};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// Stable numeric ids within one [`ReactiveComponent`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct FieldId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct PropertyId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct BindingId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct EffectId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct RegionId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct ExprId(pub u32);

/// One `.vmz` file's reactive analysis snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReactiveModule {
    /// Wire schema id ([`vmz_protocol::REACTIVE_SCHEMA`]).
    pub schema: String,
    pub source: String,
    pub components: Vec<ReactiveComponent>,
}

/// Component-level reactive graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReactiveComponent {
    pub name: String,
    pub state_slots: Vec<StateSlot>,
    pub properties: Vec<PropertySlot>,
    pub bindings: Vec<Binding>,
    pub effects: Vec<Effect>,
    pub control_regions: Vec<ControlRegion>,
    pub exprs: Vec<ExprSlot>,
}

impl ReactiveComponent {
    /// Debug / IR-json stable strings from structured paths (may include `tags[key=…].label`).
    pub fn stable_deps(&self, paths: &[IrDepPath]) -> Vec<String> {
        paths
            .iter()
            .map(|p| p.to_stable_string(&self.state_slots, &self.properties, &self.exprs))
            .collect()
    }

    /// Transitional runtime `deps` adapter.
    ///
    /// ListItem / DynamicPath with leaf props → `tags.*.label` (path channel; not bare `tags.*`).
    /// Nested each → `groups.*.items.*.label`. Whole-item / empty path → `tags.*`.
    /// DynamicPath also emits every step's `key_deps` stables.
    pub fn transitional_deps(&self, paths: &[IrDepPath]) -> Vec<String> {
        let mut out = Vec::new();
        for p in paths {
            match p {
                IrDepPath::ListItem { list, frames, path: props } => {
                    let name = self
                        .state_slots
                        .iter()
                        .find(|s| s.id == *list)
                        .map(|s| s.name.as_str())
                        .unwrap_or("?");
                    let mut s = name.to_string();
                    for (i, fr) in frames.iter().enumerate() {
                        if i == 0 {
                            for prop in &fr.via {
                                s.push('.');
                                s.push_str(self.prop_name(*prop));
                            }
                            s.push_str(".*");
                        } else {
                            for prop in &fr.via {
                                s.push('.');
                                s.push_str(self.prop_name(*prop));
                            }
                            s.push_str(".*");
                        }
                    }
                    if frames.is_empty() {
                        s.push_str(".*");
                    }
                    for prop in props {
                        s.push('.');
                        s.push_str(self.prop_name(*prop));
                    }
                    if !out.iter().any(|x| x == &s) {
                        out.push(s);
                    }
                }
                IrDepPath::DynamicPath { root, steps, path: props } => {
                    let name = self
                        .state_slots
                        .iter()
                        .find(|s| s.id == *root)
                        .map(|s| s.name.as_str())
                        .unwrap_or("?");
                    let mut s = name.to_string();
                    for step in steps {
                        for prop in &step.via {
                            s.push('.');
                            s.push_str(self.prop_name(*prop));
                        }
                        s.push_str(".*");
                    }
                    if steps.is_empty() {
                        s.push_str(".*");
                    }
                    for prop in props {
                        s.push('.');
                        s.push_str(self.prop_name(*prop));
                    }
                    if !out.iter().any(|x| x == &s) {
                        out.push(s);
                    }
                    for step in steps {
                        for kd in &step.key_deps {
                            for d in self.transitional_deps(std::slice::from_ref(kd)) {
                                if !out.iter().any(|x| x == &d) {
                                    out.push(d);
                                }
                            }
                        }
                    }
                }
                other => {
                    let s =
                        other.to_stable_string(&self.state_slots, &self.properties, &self.exprs);
                    if !out.iter().any(|x| x == &s) {
                        out.push(s);
                    }
                }
            }
        }
        out
    }

    pub fn expr_text(&self, id: ExprId) -> Option<&str> {
        self.exprs.iter().find(|e| e.id == id).map(|e| e.text.as_str())
    }

    pub fn prop_name(&self, id: PropertyId) -> &str {
        self.properties.iter().find(|p| p.id == id).map(|p| p.name.as_str()).unwrap_or("?")
    }

    pub fn field_name(&self, id: FieldId) -> &str {
        self.state_slots.iter().find(|s| s.id == id).map(|s| s.name.as_str()).unwrap_or("?")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StateSlot {
    pub id: FieldId,
    pub name: String,
    pub kind: FieldKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PropertySlot {
    pub id: PropertyId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExprSlot {
    pub id: ExprId,
    /// Source text (template or script fragment) for debugging / MCP.
    pub text: String,
}

/// One keyed `each` frame in a (possibly nested) [`IrDepPath::ListItem`].
///
/// Root `each={tags}` → `{ via: [], key }`.
/// Nested `each={g.items}` → `{ via: [items], key }` after the outer frame.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ListItemFrame {
    /// Props from the parent item to this nested list (empty for the root list).
    pub via: Vec<PropertyId>,
    pub key: Option<ExprId>,
}

/// One dynamic index step in a (possibly multi-segment) [`IrDepPath::DynamicPath`].
///
/// `items[i].label` → one step `{ via: [], key: i }` then path `[label]`.
/// `rows[r].cells[c].v` → steps `[{via:[]},{via:[cells]}]` then path `[v]`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct DynamicStep {
    /// Static props after the previous index (or after root) before this index.
    pub via: Vec<PropertyId>,
    pub key: ExprId,
    pub key_deps: Vec<IrDepPath>,
}

/// Structured dependency path (IR form; string roots via FieldId table).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IrDepPath {
    Field(FieldId),
    StaticPath {
        root: FieldId,
        props: Vec<PropertyId>,
    },
    DynamicPath {
        root: FieldId,
        steps: Vec<DynamicStep>,
        /// Trailing static props after the last dynamic index.
        path: Vec<PropertyId>,
    },
    ListItem {
        list: FieldId,
        /// Outermost → innermost each frames.
        frames: Vec<ListItemFrame>,
        /// Props on the innermost item (`tag.label` → `[label]`).
        path: Vec<PropertyId>,
    },
    /// Conservative widen to field root — explicit, never a silent miss.
    Unknown(FieldId),
}

impl IrDepPath {
    /// Stable string for transitional runtime / debug (`user.name`, `count`).
    pub fn to_stable_string(
        &self,
        fields: &[StateSlot],
        props: &[PropertySlot],
        exprs: &[ExprSlot],
    ) -> String {
        let field_name = |id: FieldId| {
            fields.iter().find(|s| s.id == id).map(|s| s.name.as_str()).unwrap_or("?")
        };
        let prop_name = |id: PropertyId| {
            props.iter().find(|p| p.id == id).map(|p| p.name.as_str()).unwrap_or("?")
        };
        let expr_text =
            |id: ExprId| exprs.iter().find(|e| e.id == id).map(|e| e.text.as_str()).unwrap_or("?");

        match self {
            Self::Field(id) | Self::Unknown(id) => field_name(*id).to_string(),
            Self::StaticPath { root, props: segs } => {
                let mut s = field_name(*root).to_string();
                for p in segs {
                    s.push('.');
                    s.push_str(prop_name(*p));
                }
                s
            }
            Self::DynamicPath { root, steps, path: segs } => {
                let mut s = field_name(*root).to_string();
                for step in steps {
                    for p in &step.via {
                        s.push('.');
                        s.push_str(prop_name(*p));
                    }
                    s.push_str(&format!("[{}]", expr_text(step.key)));
                }
                for p in segs {
                    s.push('.');
                    s.push_str(prop_name(*p));
                }
                s
            }
            Self::ListItem { list, frames, path } => {
                let mut s = field_name(*list).to_string();
                for fr in frames {
                    for p in &fr.via {
                        s.push('.');
                        s.push_str(prop_name(*p));
                    }
                    if let Some(k) = fr.key {
                        s.push_str(&format!("[key={}]", expr_text(k)));
                    } else {
                        s.push_str("[key=?]");
                    }
                }
                if frames.is_empty() {
                    s.push_str("[key=?]");
                }
                for p in path {
                    s.push('.');
                    s.push_str(prop_name(*p));
                }
                s
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BindingKind {
    Text,
    Attr,
    IfCond,
    EachList,
    EachKey,
    Event,
    ComponentProp,
}

impl BindingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Attr => "attr",
            Self::IfCond => "if_cond",
            Self::EachList => "each_list",
            Self::EachKey => "each_key",
            Self::Event => "event",
            Self::ComponentProp => "component_prop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Binding {
    pub id: BindingId,
    pub kind: BindingKind,
    pub reads: Vec<IrDepPath>,
    pub region: Option<RegionId>,
    /// Optional expression / patch hint for humans and tools.
    pub expr: Option<ExprId>,
    pub attr: Option<String>,
}

/// Write target path (transparent on the wire: just the path object).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct WritePath {
    pub path: IrDepPath,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Effect {
    pub id: EffectId,
    pub name: String,
    pub reads: Vec<IrDepPath>,
    pub writes: Vec<WritePath>,
    pub async_boundary: bool,
    pub calls: Vec<String>,
    /// Dynamic / unresolved callee — summaries must widen (stage 02).
    pub opaque_callee: bool,
    /// `(field, reason)` provenance for `field.*` Unknown widenings.
    pub star_reasons: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ControlBranch {
    /// Condition expression when present (`if` / `else-if` / ternary test); `None` = else / alt.
    pub cond: Option<ExprId>,
    pub cond_reads: Vec<IrDepPath>,
    pub body_bindings: Vec<BindingId>,
    /// Expression reads for this arm (ternary consequent/alternate; optional for template if).
    pub body_reads: Vec<IrDepPath>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ControlRegion {
    pub id: RegionId,
    pub stable: Vec<IrDepPath>,
    pub branches: Vec<ControlBranch>,
}

/// Builder for one component — allocates stable ids.
#[derive(Debug, Default)]
pub struct ReactiveComponentBuilder {
    name: String,
    state_slots: Vec<StateSlot>,
    properties: Vec<PropertySlot>,
    prop_index: HashMap<String, PropertyId>,
    field_index: HashMap<String, FieldId>,
    bindings: Vec<Binding>,
    effects: Vec<Effect>,
    control_regions: Vec<ControlRegion>,
    exprs: Vec<ExprSlot>,
    next_binding: u32,
    next_effect: u32,
    next_region: u32,
    next_expr: u32,
}

impl ReactiveComponentBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Default::default() }
    }

    pub fn add_field(&mut self, name: impl Into<String>, kind: FieldKind) -> FieldId {
        let name = name.into();
        if let Some(id) = self.field_index.get(&name) {
            return *id;
        }
        let id = FieldId(self.state_slots.len() as u32);
        self.field_index.insert(name.clone(), id);
        self.state_slots.push(StateSlot { id, name, kind });
        id
    }

    pub fn field_id(&self, name: &str) -> Option<FieldId> {
        self.field_index.get(name).copied()
    }

    pub fn intern_prop(&mut self, name: impl Into<String>) -> PropertyId {
        let name = name.into();
        if let Some(id) = self.prop_index.get(&name) {
            return *id;
        }
        let id = PropertyId(self.properties.len() as u32);
        self.prop_index.insert(name.clone(), id);
        self.properties.push(PropertySlot { id, name });
        id
    }

    pub fn intern_expr(&mut self, text: impl Into<String>) -> ExprId {
        let text = text.into();
        if let Some(e) = self.exprs.iter().find(|e| e.text == text) {
            return e.id;
        }
        let id = ExprId(self.next_expr);
        self.next_expr += 1;
        self.exprs.push(ExprSlot { id, text });
        id
    }

    /// Convert a transitional [`DepKey`] into [`IrDepPath`] using field table.
    pub fn from_dep_key(&mut self, key: &DepKey) -> Option<IrDepPath> {
        match key {
            DepKey::Field(name) => {
                let id = self.field_id(name)?;
                Some(IrDepPath::Field(id))
            }
            DepKey::FieldStar(name) => {
                // Represent as Unknown until FieldStar is a first-class IR path.
                let id = self.field_id(name)?;
                Some(IrDepPath::Unknown(id))
            }
            DepKey::Path(p) => {
                let root = self.field_id(&p.root)?;
                let mut steps: Vec<DynamicStep> = Vec::new();
                let mut via: Vec<PropertyId> = Vec::new();
                let mut saw_dyn = false;
                for seg in &p.segments {
                    match seg {
                        PathSegment::Ident(n) => via.push(self.intern_prop(n.clone())),
                        PathSegment::StaticIndex(n) => via.push(self.intern_prop(n.to_string())),
                        PathSegment::DynamicIndex(sym) => {
                            saw_dyn = true;
                            let key = self.intern_expr(sym.clone());
                            let mut key_deps = Vec::new();
                            if let Some(fid) = self.field_id(sym) {
                                key_deps.push(IrDepPath::Field(fid));
                            }
                            steps.push(DynamicStep {
                                via: std::mem::take(&mut via),
                                key,
                                key_deps,
                            });
                        }
                    }
                }
                if saw_dyn {
                    return Some(IrDepPath::DynamicPath { root, steps, path: via });
                }
                if via.is_empty() {
                    Some(IrDepPath::Field(root))
                } else {
                    Some(IrDepPath::StaticPath { root, props: via })
                }
            }
            DepKey::IndexPath { root, index, segments: segs } => {
                let id = self.field_id(root)?;
                match index {
                    PathSegment::DynamicIndex(sym) => {
                        let key = self.intern_expr(sym.clone());
                        let mut key_deps = Vec::new();
                        if let Some(fid) = self.field_id(sym) {
                            key_deps.push(IrDepPath::Field(fid));
                        }
                        let mut steps = vec![DynamicStep { via: Vec::new(), key, key_deps }];
                        let mut via: Vec<PropertyId> = Vec::new();
                        for seg in segs {
                            match seg {
                                PathSegment::Ident(n) => via.push(self.intern_prop(n.clone())),
                                PathSegment::StaticIndex(n) => {
                                    via.push(self.intern_prop(n.to_string()))
                                }
                                PathSegment::DynamicIndex(sym2) => {
                                    let key2 = self.intern_expr(sym2.clone());
                                    let mut kd2 = Vec::new();
                                    if let Some(fid) = self.field_id(sym2) {
                                        kd2.push(IrDepPath::Field(fid));
                                    }
                                    steps.push(DynamicStep {
                                        via: std::mem::take(&mut via),
                                        key: key2,
                                        key_deps: kd2,
                                    });
                                }
                            }
                        }
                        Some(IrDepPath::DynamicPath { root: id, steps, path: via })
                    }
                    PathSegment::StaticIndex(n) => {
                        let mut props = vec![self.intern_prop(n.to_string())];
                        let mut steps: Vec<DynamicStep> = Vec::new();
                        let mut via: Vec<PropertyId> = Vec::new();
                        let mut building_static = true;
                        for seg in segs {
                            match seg {
                                PathSegment::Ident(name) if building_static => {
                                    props.push(self.intern_prop(name.clone()))
                                }
                                PathSegment::StaticIndex(i) if building_static => {
                                    props.push(self.intern_prop(i.to_string()))
                                }
                                PathSegment::DynamicIndex(sym) => {
                                    building_static = false;
                                    let key = self.intern_expr(sym.clone());
                                    let mut key_deps = Vec::new();
                                    if let Some(fid) = self.field_id(sym) {
                                        key_deps.push(IrDepPath::Field(fid));
                                    }
                                    let step_via = if steps.is_empty() {
                                        std::mem::take(&mut props)
                                    } else {
                                        std::mem::take(&mut via)
                                    };
                                    steps.push(DynamicStep { via: step_via, key, key_deps });
                                }
                                PathSegment::Ident(name) => {
                                    via.push(self.intern_prop(name.clone()))
                                }
                                PathSegment::StaticIndex(i) => {
                                    via.push(self.intern_prop(i.to_string()))
                                }
                            }
                        }
                        if steps.is_empty() {
                            Some(IrDepPath::StaticPath { root: id, props })
                        } else {
                            Some(IrDepPath::DynamicPath { root: id, steps, path: via })
                        }
                    }
                    PathSegment::Ident(_) => Some(IrDepPath::Unknown(id)),
                }
            }
        }
    }

    pub fn binding_count(&self) -> u32 {
        self.next_binding
    }

    pub fn binding_kind(&self, id: BindingId) -> Option<BindingKind> {
        self.bindings.iter().find(|b| b.id == id).map(|b| b.kind)
    }

    pub fn binding_region(&self, id: BindingId) -> Option<RegionId> {
        self.bindings.iter().find(|b| b.id == id).and_then(|b| b.region)
    }

    pub fn set_binding_region(&mut self, id: BindingId, region: RegionId) {
        if let Some(b) = self.bindings.iter_mut().find(|b| b.id == id) {
            b.region = Some(region);
        }
    }

    pub fn add_binding(
        &mut self,
        kind: BindingKind,
        reads: Vec<IrDepPath>,
        region: Option<RegionId>,
        expr: Option<ExprId>,
        attr: Option<String>,
    ) -> BindingId {
        let id = BindingId(self.next_binding);
        self.next_binding += 1;
        self.bindings.push(Binding { id, kind, reads, region, expr, attr });
        id
    }

    pub fn add_effect(
        &mut self,
        name: impl Into<String>,
        reads: Vec<IrDepPath>,
        writes: Vec<WritePath>,
        async_boundary: bool,
        calls: Vec<String>,
        opaque_callee: bool,
        star_reasons: Vec<(String, String)>,
    ) -> EffectId {
        let id = EffectId(self.next_effect);
        self.next_effect += 1;
        self.effects.push(Effect {
            id,
            name: name.into(),
            reads,
            writes,
            async_boundary,
            calls,
            opaque_callee,
            star_reasons,
        });
        id
    }

    pub fn add_control_region(
        &mut self,
        stable: Vec<IrDepPath>,
        branches: Vec<ControlBranch>,
    ) -> RegionId {
        let id = RegionId(self.next_region);
        self.next_region += 1;
        self.control_regions.push(ControlRegion { id, stable, branches });
        id
    }

    pub fn finish(self) -> ReactiveComponent {
        ReactiveComponent {
            name: self.name,
            state_slots: self.state_slots,
            properties: self.properties,
            bindings: self.bindings,
            effects: self.effects,
            control_regions: self.control_regions,
            exprs: self.exprs,
        }
    }
}

impl ReactiveModule {
    /// Pretty JSON for `*.reactive.json`.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// JSON for one reactive component (also embedded under Program IR `reactive`).
/// `indent` is ignored; prefer nesting via serde on [`ReactiveComponent`].
pub fn reactive_component_json(c: &ReactiveComponent, _indent: &str) -> String {
    serde_json::to_string_pretty(c).unwrap_or_else(|_| "{}".into())
}

impl fmt::Display for IrDepPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

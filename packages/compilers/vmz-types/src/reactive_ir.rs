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

/// Stable id of a property segment used in structured [`IrDepPath`]s.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct PropertyId(pub u32);

/// Stable id of a template / script binding within one component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct BindingId(pub u32);

/// Stable id of an effect (method summary) within one component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct EffectId(pub u32);

/// Stable id of a control / lifetime region (`if` / `each` / ternary).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct RegionId(pub u32);

/// Stable id of an interned expression fragment (source text table).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct ExprId(pub u32);

/// One `.vmz` file's reactive analysis snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReactiveModule {
    /// Wire schema id ([`vmz_protocol::REACTIVE_SCHEMA`]).
    pub schema: String,
    /// Workspace-relative source path of the analyzed `.vmz` file.
    pub source: String,
    /// Components discovered in this module (usually one default export).
    pub components: Vec<ReactiveComponent>,
}

/// Component-level reactive graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReactiveComponent {
    /// Component class name (default export).
    pub name: String,
    /// Prop and state fields as reactive slots.
    pub state_slots: Vec<StateSlot>,
    /// Interned property names used in structured dep paths.
    pub properties: Vec<PropertySlot>,
    /// Template / event bindings and their read sets.
    pub bindings: Vec<Binding>,
    /// Method effect summaries (reads / writes / calls).
    pub effects: Vec<Effect>,
    /// Control regions for `if` / ternary / related branching.
    pub control_regions: Vec<ControlRegion>,
    /// Interned expression texts referenced by ids.
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
                    for fr in frames {
                        for prop in &fr.via {
                            s.push('.');
                            s.push_str(self.prop_name(*prop));
                        }
                        s.push_str(".*");
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

    /// Look up interned expression text by [`ExprId`].
    pub fn expr_text(&self, id: ExprId) -> Option<&str> {
        self.exprs.iter().find(|e| e.id == id).map(|e| e.text.as_str())
    }

    /// Property name for `id`, or `"?"` when the table has no entry.
    pub fn prop_name(&self, id: PropertyId) -> &str {
        self.properties.iter().find(|p| p.id == id).map(|p| p.name.as_str()).unwrap_or("?")
    }

    /// Field name for `id`, or `"?"` when the table has no entry.
    pub fn field_name(&self, id: FieldId) -> &str {
        self.state_slots.iter().find(|s| s.id == id).map(|s| s.name.as_str()).unwrap_or("?")
    }
}

/// One prop or state field as a reactive slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StateSlot {
    /// Stable field id shared with Program IR semantic view.
    pub id: FieldId,
    /// Source field name.
    pub name: String,
    /// Prop vs state classification.
    pub kind: FieldKind,
}

/// Interned property name used in structured dependency paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PropertySlot {
    /// Stable property id within this component.
    pub id: PropertyId,
    /// Property / segment name (e.g. `label`, `items`).
    pub name: String,
}

/// Interned expression fragment referenced by [`ExprId`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExprSlot {
    /// Stable expression id within this component.
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
    /// Optional key expression for this each frame.
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
    /// Index expression for this dynamic step.
    pub key: ExprId,
    /// Dependencies of the index expression (propagated into transitional deps).
    pub key_deps: Vec<IrDepPath>,
}

/// Structured dependency path (IR form; string roots via FieldId table).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
pub enum IrDepPath {
    /// Whole field root (`count`, `user`).
    Field(FieldId),
    /// Static property chain (`user.name`).
    StaticPath {
        /// Root field id.
        root: FieldId,
        /// Static property segments after the root.
        properties: Vec<PropertyId>,
    },
    /// Dynamic index chain (`items[i].label`, multi-step indexes).
    DynamicPath {
        /// Root field id.
        root: FieldId,
        /// Dynamic index steps in order.
        steps: Vec<DynamicStep>,
        /// Trailing static props after the last dynamic index.
        path: Vec<PropertyId>,
    },
    /// Path under a keyed `each` item (possibly nested frames).
    ListItem {
        /// List field being iterated.
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
            Self::StaticPath { root, properties: segs } => {
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

/// How a binding participates in the template / event surface.
///
/// **Closed** unit enum — Copy filter helper for `take_binding(&[…])` etc.
/// The wire payload is [`Binding`] (tagged union), not `struct { kind, … }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum BindingKind {
    /// Text interpolation binding.
    Text,
    /// Element / component attribute binding.
    Attr,
    /// Condition of an `if` / `else-if` / ternary.
    IfCond,
    /// List expression of an `each`.
    EachList,
    /// Key expression of an `each`.
    EachKey,
    /// Event handler binding (`onClick`, etc.).
    Event,
    /// Prop passed into a child component.
    ComponentProp,
}

impl BindingKind {
    /// Wire / JSON label for this binding kind (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Attr => "attr",
            Self::IfCond => "if-cond",
            Self::EachList => "each-list",
            Self::EachKey => "each-key",
            Self::Event => "event",
            Self::ComponentProp => "component-prop",
        }
    }
}

/// One template / event binding and its reactive read set.
///
/// **Tagged union** (`tag = "kind"`). Prefer matching variants over
/// `b.kind() == BindingKind::Attr` then reading optional `attr`.
/// Attribute / event / component-prop names live only on those variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Binding {
    /// Text interpolation binding.
    Text {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
    },
    /// Element attribute binding (`class`, `title`, …).
    Attr {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
        /// Attribute name (required on this surface).
        attr: String,
    },
    /// Condition of an `if` / `else-if` / ternary.
    IfCond {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
    },
    /// List expression of an `each`.
    EachList {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
    },
    /// Key expression of an `each`.
    EachKey {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
    },
    /// Event handler binding (`onClick`, etc.).
    Event {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
        /// Event attribute name (`onClick`, …).
        attr: String,
    },
    /// Prop passed into a child component.
    ComponentProp {
        /// Stable binding id within this component.
        id: BindingId,
        /// Structured paths this binding reads.
        reads: Vec<IrDepPath>,
        /// Control region that owns this binding, when nested under `if` / similar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<RegionId>,
        /// Optional expression / patch hint for humans and tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ExprId>,
        /// Prop name on the child component.
        attr: String,
    },
}

impl Binding {
    /// Stable binding id within this component.
    pub fn id(&self) -> BindingId {
        match self {
            Self::Text { id, .. }
            | Self::Attr { id, .. }
            | Self::IfCond { id, .. }
            | Self::EachList { id, .. }
            | Self::EachKey { id, .. }
            | Self::Event { id, .. }
            | Self::ComponentProp { id, .. } => *id,
        }
    }

    /// Closed discriminant (filter helper; prefer matching `self` when possible).
    pub fn kind(&self) -> BindingKind {
        match self {
            Self::Text { .. } => BindingKind::Text,
            Self::Attr { .. } => BindingKind::Attr,
            Self::IfCond { .. } => BindingKind::IfCond,
            Self::EachList { .. } => BindingKind::EachList,
            Self::EachKey { .. } => BindingKind::EachKey,
            Self::Event { .. } => BindingKind::Event,
            Self::ComponentProp { .. } => BindingKind::ComponentProp,
        }
    }

    /// Structured paths this binding reads.
    pub fn reads(&self) -> &[IrDepPath] {
        match self {
            Self::Text { reads, .. }
            | Self::Attr { reads, .. }
            | Self::IfCond { reads, .. }
            | Self::EachList { reads, .. }
            | Self::EachKey { reads, .. }
            | Self::Event { reads, .. }
            | Self::ComponentProp { reads, .. } => reads,
        }
    }

    /// Owning control region, when nested under `if` / similar.
    pub fn region(&self) -> Option<RegionId> {
        match self {
            Self::Text { region, .. }
            | Self::Attr { region, .. }
            | Self::IfCond { region, .. }
            | Self::EachList { region, .. }
            | Self::EachKey { region, .. }
            | Self::Event { region, .. }
            | Self::ComponentProp { region, .. } => *region,
        }
    }

    /// Attach or replace the control region for this binding.
    pub fn set_region(&mut self, region: RegionId) {
        match self {
            Self::Text { region: r, .. }
            | Self::Attr { region: r, .. }
            | Self::IfCond { region: r, .. }
            | Self::EachList { region: r, .. }
            | Self::EachKey { region: r, .. }
            | Self::Event { region: r, .. }
            | Self::ComponentProp { region: r, .. } => *r = Some(region),
        }
    }

    /// Optional expression / patch hint.
    pub fn expr(&self) -> Option<ExprId> {
        match self {
            Self::Text { expr, .. }
            | Self::Attr { expr, .. }
            | Self::IfCond { expr, .. }
            | Self::EachList { expr, .. }
            | Self::EachKey { expr, .. }
            | Self::Event { expr, .. }
            | Self::ComponentProp { expr, .. } => *expr,
        }
    }

    /// Attribute / event / prop name when this surface carries one.
    pub fn attr(&self) -> Option<&str> {
        match self {
            Self::Attr { attr, .. }
            | Self::Event { attr, .. }
            | Self::ComponentProp { attr, .. } => Some(attr.as_str()),
            _ => None,
        }
    }

    /// Build a binding for the given kind (attr required for Attr / Event / ComponentProp).
    pub fn new(
        id: BindingId,
        kind: BindingKind,
        reads: Vec<IrDepPath>,
        region: Option<RegionId>,
        expr: Option<ExprId>,
        attr: Option<String>,
    ) -> Self {
        match kind {
            BindingKind::Text => Self::Text { id, reads, region, expr },
            BindingKind::Attr => {
                Self::Attr { id, reads, region, expr, attr: attr.unwrap_or_default() }
            }
            BindingKind::IfCond => Self::IfCond { id, reads, region, expr },
            BindingKind::EachList => Self::EachList { id, reads, region, expr },
            BindingKind::EachKey => Self::EachKey { id, reads, region, expr },
            BindingKind::Event => {
                Self::Event { id, reads, region, expr, attr: attr.unwrap_or_default() }
            }
            BindingKind::ComponentProp => {
                Self::ComponentProp { id, reads, region, expr, attr: attr.unwrap_or_default() }
            }
        }
    }
}

/// Write target path (transparent on the wire: just the path object).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct WritePath {
    /// Structured path written by an effect.
    pub path: IrDepPath,
}

/// Method-level effect summary (reads, writes, calls, opacity).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Effect {
    /// Stable effect id (aligned with semantic method id in Program IR).
    pub id: EffectId,
    /// Method name (`onMount`, `#private`, etc.).
    pub name: String,
    /// Paths read by the method body (including composed callees).
    pub reads: Vec<IrDepPath>,
    /// Paths written by the method body (including composed callees).
    pub writes: Vec<WritePath>,
    /// True when the method is `async` or crosses an async boundary.
    pub async_boundary: bool,
    /// Sibling method names called via `this.method` / `this.#method`.
    pub calls: Vec<String>,
    /// Dynamic / unresolved callee — summaries must widen (stage 02).
    pub opaque_callee: bool,
    /// `(field, reason)` provenance for `field.*` Unknown widenings.
    pub star_reasons: Vec<(String, String)>,
}

/// One arm of a control region (`if` / `else-if` / `else` / ternary).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ControlBranch {
    /// Condition expression when present (`if` / `else-if` / ternary test); `None` = else / alt.
    pub cond: Option<ExprId>,
    /// Paths read by the condition expression.
    pub cond_reads: Vec<IrDepPath>,
    /// Bindings belonging to this arm's body.
    pub body_bindings: Vec<BindingId>,
    /// Expression reads for this arm (ternary consequent/alternate; optional for template if).
    pub body_reads: Vec<IrDepPath>,
}

/// Control / branching region sharing [`RegionId`] with lifetime / view projections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ControlRegion {
    /// Stable region id within this component.
    pub id: RegionId,
    /// Paths that remain stable across branch switches (not disposed with the arm).
    pub stable: Vec<IrDepPath>,
    /// Ordered branches (`if`, `else-if`..., `else` / ternary arms).
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
    /// Start a builder for a component named `name`.
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Default::default() }
    }

    /// Allocate or reuse a field slot; returns its [`FieldId`].
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

    /// Look up an existing field id by name.
    pub fn field_id(&self, name: &str) -> Option<FieldId> {
        self.field_index.get(name).copied()
    }

    /// Intern a property name into the property table.
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

    /// Intern expression source text; reuses an existing [`ExprId`] on exact match.
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
                    Some(IrDepPath::StaticPath { root, properties: via })
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
                            Some(IrDepPath::StaticPath { root: id, properties: props })
                        } else {
                            Some(IrDepPath::DynamicPath { root: id, steps, path: via })
                        }
                    }
                    PathSegment::Ident(_) => Some(IrDepPath::Unknown(id)),
                }
            }
        }
    }

    /// Number of bindings allocated so far (next id value).
    pub fn binding_count(&self) -> u32 {
        self.next_binding
    }

    /// Kind of an existing binding, if present.
    pub fn binding_kind(&self, id: BindingId) -> Option<BindingKind> {
        self.bindings.iter().find(|b| b.id() == id).map(|b| b.kind())
    }

    /// Owning region of an existing binding, if set.
    pub fn binding_region(&self, id: BindingId) -> Option<RegionId> {
        self.bindings.iter().find(|b| b.id() == id).and_then(|b| b.region())
    }

    /// Attach or replace the control region for a binding.
    pub fn set_binding_region(&mut self, id: BindingId, region: RegionId) {
        if let Some(b) = self.bindings.iter_mut().find(|b| b.id() == id) {
            b.set_region(region);
        }
    }

    /// Allocate a new binding with the given kind, reads, and optional metadata.
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
        self.bindings.push(Binding::new(id, kind, reads, region, expr, attr));
        id
    }

    /// Allocate a new effect summary for a method.
    #[allow(clippy::too_many_arguments)]
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

    /// Allocate a new control region with stable paths and branches.
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

    /// Finish building and return the immutable [`ReactiveComponent`].
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
    /// Pretty JSON for `*.reactive.json` via serde.
    /// Pretty-printed dump for tooling. **Not** a production artifact printer —
    /// write `*.reactive.json` via `vmz_generator::to_pretty_json` from the compiler.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

impl fmt::Display for IrDepPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

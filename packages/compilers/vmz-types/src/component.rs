//! Component surface extracted from `.vmz` (oxc-parsed TypeScript).
//!
//! Convention:
//! - `export default class` is the component entry.
//! - `public` fields are props.
//! - non-public fields are state; the compiler tracks reads/writes (no `useX` / `createX`).
//! - other classes in the same file are internal helpers.
//! - heavy class logic inside `.vmz` is discouraged; prefer field + template updates.
//!
//! Full-stack project conventions (auto, no manual `.vmz` imports):
//! - `src/Application.vmz` - root shell (hard canonical name)
//! - `src/pages/**` - file routes; PascalCase stems (`Index.vmz`); URL from lowercased stem
//! - Named layouts: `*Layout` suffix recommended (lint), e.g. `AccountLayout.vmz`
//! - Route-group boundary roles (exact): `Layout.vmz` / `Loading.vmz` / `Error.vmz` / `NotFound.vmz`
//! - `src/components/**` - auto-available in templates by file name
//! - `src/server/**` - server implementation libraries (`#server/...`)

use oxc_span::Span;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// TypeScript visibility on a class member (`public` / `private` / `protected`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Visibility {
    /// `public` - props when on the default-exported component class.
    Public,
    /// `private` or unmarked - reactive state (not a prop).
    Private,
    /// `protected` - treated like non-public state for the component contract.
    Protected,
}

/// How a field participates in the component contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FieldKind {
    /// `public` field on the default-exported class -> component prop.
    Prop,
    /// Non-public field -> compiler-tracked reactive state (not a prop).
    State,
}

impl FieldKind {
    /// Wire / JSON label: `prop` or `state`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prop => "prop",
            Self::State => "state",
        }
    }
}

/// One field on the default-exported component class (prop or state).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDecl {
    /// Field identifier as written in source.
    pub name: String,
    /// Optional TypeScript type annotation text.
    pub type_text: Option<String>,
    /// Initializer expression text (e.g. `0`, `this.initial`), if any.
    pub init_text: Option<String>,
    /// Prop vs state classification.
    pub kind: FieldKind,
    /// Source visibility keyword.
    pub visibility: Visibility,
    /// Source span of the field declaration.
    pub span: Span,
}

/// REST surface from `@Get` / `@Post` / ... on a server method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct HttpRoute {
    /// Uppercase verb: GET, POST, PUT, DELETE, PATCH.
    pub verb: String,
    /// Route path template from the decorator.
    pub path: String,
}

/// One method on the component or co-located server class.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MethodDecl {
    /// Method name (`#` prefix kept for JS private methods).
    pub name: String,
    /// Whether the method is `async`.
    pub is_async: bool,
    /// Whether the method is `static`.
    pub is_static: bool,
    /// True when name starts with `#` (JS private).
    pub is_private: bool,
    /// Optional HTTP route when this is a server method with REST decorators.
    pub http: Option<HttpRoute>,
    /// Field / path reads: local body plus composed summaries of known callees.
    pub reads: Vec<String>,
    /// Field / path writes: local body plus composed summaries of known callees.
    pub writes: Vec<String>,
    /// Sibling `this.method` / `this.#method` callees (filtered to known methods).
    /// Edges remain after composition so tools can explain the summary.
    pub calls: Vec<String>,
    /// True when the body has a dynamic / unresolved callee (`this[k]`, or
    /// `this.foo` where `foo` is not a known class method). Summaries must
    /// conservatively widen; never pretend the call is a no-op.
    pub opaque_callee: bool,
    /// Provenance for `field.*` widenings: `(field, reason)`.
    /// Reasons: `opaque_callee` | `unresolved_method` | `array_destructure` |
    /// `computed_member` | `rest_destructure` | `closure_boundary` | `field_star`.
    pub star_reasons: Vec<(String, String)>,
    /// Source span of the method declaration.
    pub span: Span,
}

/// Non-default class declared in the same `.vmz` file (helper, not a component).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalClassDecl {
    /// Class name.
    pub name: String,
    /// Source span of the class declaration.
    pub span: Span,
}

/// Default-exported component class extracted from one `.vmz` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentDecl {
    /// Class name (also the component display name).
    pub name: String,
    /// `public` fields (props only).
    pub properties: Vec<FieldDecl>,
    /// All tracked fields (props + state); tools often prefer this list.
    pub fields: Vec<FieldDecl>,
    /// Instance / static methods with read/write/call summaries.
    pub methods: Vec<MethodDecl>,
    /// Other classes in the same file (not separately mountable).
    pub internal_classes: Vec<InternalClassDecl>,
    /// Source span of the class declaration.
    pub span: Span,
}

impl ComponentDecl {
    /// Empty component shell with a name and span; lists filled by analyze.
    pub fn new(name: impl Into<String>, span: Span) -> Self {
        Self {
            name: name.into(),
            properties: Vec::new(),
            fields: Vec::new(),
            methods: Vec::new(),
            internal_classes: Vec::new(),
            span,
        }
    }
}

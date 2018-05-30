//! Component surface extracted from `.vmz` (oxc-parsed TypeScript).
//!
//! Convention:
//! - `export default class` is the component entry.
//! - `public` fields are props.
//! - non-public fields are state — the compiler tracks reads/writes (no `useX` / `createX`).
//! - other classes in the same file are internal helpers.
//! - heavy class logic inside `.vmz` is discouraged; prefer field + template updates.
//!
//! Full-stack project conventions (auto, no manual `.vmz` imports):
//! - `src/Application.vmz` — root shell (hard canonical name)
//! - `src/pages/**` — file routes; PascalCase stems (`Index.vmz`); URL from lowercased stem
//! - Named layouts: `*Layout` suffix recommended (lint), e.g. `AccountLayout.vmz`
//! - Route-group boundary roles (exact): `Layout.vmz` / `Loading.vmz` / `Error.vmz` / `NotFound.vmz`
//! - `src/components/**` — auto-available in templates by file name
//! - `src/server/**` — server implementation libraries (`#server/...`)

use oxc_span::Span;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Visibility {
    Public,
    Private,
    Protected,
}

/// How a field participates in the component contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FieldKind {
    /// `public` field on the default-exported class → component prop.
    Prop,
    /// Non-public field → compiler-tracked reactive state (not a prop).
    State,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDecl {
    pub name: String,
    pub type_text: Option<String>,
    /// Initializer expression text (e.g. `0`, `this.initial`), if any.
    pub init_text: Option<String>,
    pub kind: FieldKind,
    pub visibility: Visibility,
    pub span: Span,
}

/// REST surface from `@Get` / `@Post` / … on a server method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRoute {
    /// Uppercase verb: GET, POST, PUT, DELETE, PATCH.
    pub verb: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MethodDecl {
    pub name: String,
    pub is_async: bool,
    pub is_static: bool,
    /// True when name starts with `#` (JS private).
    pub is_private: bool,
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
    /// conservatively widen — never pretend the call is a no-op.
    pub opaque_callee: bool,
    /// Provenance for `field.*` widenings: `(field, reason)`.
    /// Reasons: `opaque_callee` | `unresolved_method` | `array_destructure` |
    /// `computed_member` | `rest_destructure` | `closure_boundary` | `field_star`.
    pub star_reasons: Vec<(String, String)>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalClassDecl {
    pub name: String,
    pub span: Span,
}

/// Default-exported component class.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentDecl {
    pub name: String,
    pub props: Vec<FieldDecl>,
    pub fields: Vec<FieldDecl>,
    pub methods: Vec<MethodDecl>,
    pub internal_classes: Vec<InternalClassDecl>,
    pub span: Span,
}

impl ComponentDecl {
    pub fn new(name: impl Into<String>, span: Span) -> Self {
        Self {
            name: name.into(),
            props: Vec::new(),
            fields: Vec::new(),
            methods: Vec::new(),
            internal_classes: Vec::new(),
            span,
        }
    }
}

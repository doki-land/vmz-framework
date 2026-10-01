//! Language-neutral analysis input for Nyar (phase D contract).
//!
//! No Oak, oxc, or `vmz-compiler` types — VMZ projects into this shape before Nyar analysis.

use crate::contract::{ByteSpan, SfcDocumentView};

/// Full VMZ unit payload for Nyar consumers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarAnalysisInput {
    /// Ordered SFC block regions and source text.
    pub document: SfcDocumentView,
    /// Client and optional server program surfaces.
    pub programs: Vec<NyarProgramUnit>,
    /// `true` when a `<script server>` block exists (full-stack boundary marker).
    pub has_server_boundary: bool,
}

/// Client vs server script role in a `.vmz` file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NyarProgramRole {
    /// `<script client>` default-export class.
    Client,
    /// `<script server>` capability / REST surface.
    Server,
}

/// One analyzed script block projected for Nyar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarProgramUnit {
    /// Client or server role.
    pub role: NyarProgramRole,
    /// Inner script body span in the `.vmz` file.
    pub content_span: ByteSpan,
    /// Default-exported class name.
    pub component_name: String,
    /// Props, state fields, and methods on the default-exported class.
    pub members: Vec<NyarMember>,
    /// Co-located helper classes in the same script block.
    pub internal_types: Vec<NyarInternalType>,
    /// Static ES module imports (cross-file edges; raw specifiers, unresolved).
    pub imports: Vec<NyarImportDecl>,
}

/// Kind of module edge projected for Nyar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NyarImportKind {
    /// `import … from '…'`.
    Static,
    /// `export { … } from '…'` / `export * from '…'` (later peels).
    ExportFrom,
}

/// How a local binding is bound from the module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NyarBindingKind {
    /// `import local from '…'`.
    Default,
    /// `import { name }` / `import { name as local }`.
    Named,
    /// `import * as local from '…'`.
    Namespace,
}

/// One local binding from an import declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarImportBinding {
    /// Local identifier in this script.
    pub local: String,
    /// Remote export name when named (`None` for default / namespace).
    pub imported: Option<String>,
    /// Default / named / namespace.
    pub binding_kind: NyarBindingKind,
    /// Span of the local name in the `.vmz` file (best-effort; may equal `decl_span`).
    pub name_span: ByteSpan,
}

/// One static import (or later export-from) declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarImportDecl {
    /// Static vs export-from.
    pub kind: NyarImportKind,
    /// Module specifier as written (`./lib`, `@pkg/types`, …) without quotes.
    pub module_specifier: String,
    /// Local bindings introduced by this declaration.
    pub specifiers: Vec<NyarImportBinding>,
    /// `import type` / `export type`.
    pub is_type_only: bool,
    /// Full declaration span in the `.vmz` file.
    pub decl_span: ByteSpan,
    /// Span covering the module string literal when known (else `decl_span`).
    pub specifier_span: ByteSpan,
}

/// Member classification for Nyar symbol tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NyarMemberKind {
    /// `public` field on the default-exported class.
    Prop,
    /// Non-public reactive field.
    State,
    /// Instance or static method.
    Method,
}

/// One symbol on the default-exported component class.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarMember {
    /// Identifier as written in source.
    pub name: String,
    /// Prop / state / method classification.
    pub kind: NyarMemberKind,
    /// Span of the member name in the `.vmz` file.
    pub name_span: ByteSpan,
    /// Span of the full member declaration in the `.vmz` file.
    pub decl_span: ByteSpan,
    /// Type annotation text when present (fields only).
    pub type_text: Option<String>,
    /// `true` for `async` methods.
    pub is_async: bool,
    /// REST route when the method carries HTTP decorators (server only).
    pub http_route: Option<NyarHttpRoute>,
}

/// REST surface extracted from server decorators.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarHttpRoute {
    /// Uppercase verb such as `GET`.
    pub verb: String,
    /// Route path template from the decorator.
    pub path: String,
}

/// Helper class declared alongside the default export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NyarInternalType {
    /// Class name.
    pub name: String,
    /// Span of the class name in the `.vmz` file.
    pub name_span: ByteSpan,
}

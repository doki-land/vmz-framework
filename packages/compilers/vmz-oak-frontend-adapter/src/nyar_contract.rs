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

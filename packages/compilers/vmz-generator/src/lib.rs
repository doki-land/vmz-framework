//! VMZ artifact CodeGenerators.
//!
//! Consumes typed IR from `vmz-types` / `vmz-protocol` and prints final text
//! artifacts. Does **not** parse `.vmz` or build Program Graph / Execution Plan.
//!
//! Dependency rule: this crate must never depend on `vmz-compiler`.

#![deny(missing_docs)]

pub mod core;
pub mod css;
pub mod js;
pub mod json;
pub mod lang;
pub mod markup;

pub use core::{
    ContentType, EmittedArtifact, GeneratorError, Provenance, Result, escape_css_string,
    escape_html_attr, escape_html_text, escape_xml_attr, escape_xml_text, sha256_hex,
};
pub use js::{
    EmittedJs, ServerBridge, bind_field_idents, emit_client_module, emit_server_module,
    is_direct_eligible, transpile_ts, transpile_ts_with_map,
};
pub use css::{
    StyleContribution, StyleEmitReport, StyleLayer, emit_style_bundle, format_css, validate_css,
};
pub use json::to_pretty_json;
pub use markup::{MarkupDocument, MarkupNode, emit_html_document, emit_markup};
pub use lang::emit_rust_server_unit;

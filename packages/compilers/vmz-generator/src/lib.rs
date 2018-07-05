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
pub use css::{
    StyleContribution, StyleEmitReport, StyleLayer, ThemeDecl, ThemeRule, css_var_name,
    emit_style_bundle, emit_theme_css, format_css, theme_attr_selector, validate_css,
};
pub use js::{
    EmittedJs, ServerBridge, bind_field_idents, emit_client_module, emit_server_module,
    is_direct_eligible, transpile_ts, transpile_ts_with_map,
};
pub use json::{
    DataFormat, emit_data, emit_data_artifact, to_json, to_json5, to_pretty_json, to_yaml,
};
pub use lang::emit_rust_server_unit;
pub use markup::{
    HreflangAlternate, MINI_TEMPLATE_DIALECT, MarkupDocument, MarkupNode, MiniEmitError,
    MiniEmitErrorKind, MiniEventHandler, MiniTemplateEmit, MiniTemplateProfile, PageShellInput,
    PageShellMeta, SitemapUrl, emit_html_document, emit_markup, emit_mini_template,
    emit_mini_template_profile, emit_page_shell, emit_sitemap_xml,
};

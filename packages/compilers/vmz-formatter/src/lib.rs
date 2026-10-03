//! VMZ formatter: `.vmz` SFC authoring + hybrid workspace surfaces (JS/TS + `cargo fmt`).
//!
//! Final `.vmz` text exits through [`VmzDocument`]. `<template>` prints from the
//! Semantic AST with OXC-canonical expressions. Script/style bodies go through
//! Oak TypeScript and the VMZ CSS formatter.

#![deny(missing_docs)]

mod assemble;
mod document;
mod editorconfig;
mod path;
mod script;
mod style;
mod template_print;
mod workspace;

pub use document::VmzDocument;
pub use path::{FormatOptions, FormatReport, format_path};
pub use template_print::format_template_body;
pub use workspace::{
    default_format_options, format_source_with_options, run_workspace_format, WorkspaceFormatOptions,
    WorkspaceFormatReport,
};

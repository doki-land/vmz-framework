//! VMZ formatter: `.vmz` SFC authoring + explicit-target surfaces (JS/TS + per-file `rustfmt`).
//!
//! Final `.vmz` text exits through [`VmzDocument`]. `<template>` prints from the
//! Semantic AST with Oak-formatted expressions. Script/style bodies go through
//! Oak TypeScript and the VMZ CSS formatter. Format scope is always the explicit
//! CLI path — never an implicit workspace walk.

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
    TargetFormatOptions, TargetFormatReport, default_format_options, format_source_with_options,
    run_target_format,
};

//! VMZ authoring formatter: `.vmz` SFC + EditorConfig.
//!
//! Final `.vmz` text exits through [`VmzDocument`]. `<template>` prints from the
//! Semantic AST with OXC-canonical expressions. Script/style bodies go through
//! `oxc_formatter` / `oxc_formatter_css`.

#![deny(missing_docs)]

mod assemble;
mod document;
mod editorconfig;
mod path;
mod script;
mod style;
mod template_print;

pub use document::VmzDocument;
pub use path::{FormatOptions, FormatReport, format_path};
pub use template_print::format_template_body;

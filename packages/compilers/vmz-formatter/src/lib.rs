//! VMZ authoring formatter: `.vmz` SFC + oxc IR formatter + EditorConfig.
//!
//! This crate is **not** an AST pretty-printer. Script/style bodies go through
//! `oxc_formatter` / `oxc_formatter_css`. Codegen stays in `vmz-generator`.

#![deny(missing_docs)]

mod assemble;
mod editorconfig;
mod path;
mod script;
mod style;

pub use path::{FormatOptions, FormatReport, format_path};

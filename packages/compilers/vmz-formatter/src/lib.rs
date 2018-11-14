//! VMZ authoring formatter: `.vmz` SFC + EditorConfig.
//!
//! `<template>` is pretty-printed from the Semantic AST as Vue syntax (no JSX).
//! Script/style bodies go through `oxc_formatter` / `oxc_formatter_css`.

#![deny(missing_docs)]

mod assemble;
mod editorconfig;
mod path;
mod script;
mod style;
mod template_print;

pub use path::{FormatOptions, FormatReport, format_path};
pub use template_print::format_template_body;

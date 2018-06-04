//! VMZ SCSS style plugin: `<style>` (default SCSS) → sasso → CSS.
//!
//! Compiler-side style plugin (not an ecosystem `@vmz/plugin-*`). Linked into the
//! single `vmz` binary; never ships a second CLI.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod production;

pub use production::{ProductionScssCompiler, default_scss_compiler};

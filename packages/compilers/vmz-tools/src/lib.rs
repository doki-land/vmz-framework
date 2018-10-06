//! VMZ native CLI library surface (binary entry is `main.rs`).
#![deny(missing_docs)]

/// Clap root parser and shared path arguments for the `vmz` binary.
pub mod cli;
/// Subcommand implementations (`new`, `build`, `check`, ...).
pub mod commands;
/// CLI-only diagnostic formatting (`offset` → `line:col`).
pub mod diagnostic_fmt;

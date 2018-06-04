//! VMZ TW style plugin: `style:tw` / `@tailwind` → `tailwind-rs` → CSS.
//!
//! Compiler-side style plugin (not an ecosystem `@vmz/plugin-*`). Linked into the
//! single `vmz` binary via [`default_tw_compiler`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod collect;
mod designs;
mod engine_bridge;
mod pipeline;
mod production;

pub use collect::{
    TwCollection, TwSite, TwTokenHit, TwTokenKind, collect_from_source, collect_from_vmz,
};
pub use designs::{DesignsStub, ThemeLoadError, load_theme_from_designs, scan_designs_dir};
pub use engine_bridge::{EngineLowering, compile_collection, compile_registrations};
pub use pipeline::{PipelineOptions, PipelineResult, run_pipeline, run_pipeline_source};
pub use production::{ProductionTwCompiler, default_tw_compiler};

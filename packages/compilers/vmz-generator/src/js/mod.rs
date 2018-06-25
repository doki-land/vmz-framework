//! JavaScript CodeGenerator (oxc parse / transform / codegen).

mod ast_util;
mod deps;
mod emit;
mod emit_direct;
mod emit_ir;
mod entry;
/// Shared expression / attr helpers (also used by `vmz-compiler` structural build).
pub mod helpers;
mod locale;
mod row_kernel;
mod transpile;

pub use deps::collect_template_deps;
pub use emit::{
    EmittedJs, ServerBridge, emit_client_module, emit_entry_client, emit_server_module,
    rewrite_ts_spec_imports, rewrite_virtual_import,
};
pub use emit_direct::{emit_direct_create, emit_vmz_plan, is_direct_eligible};
pub use emit_ir::{IrDepCursor, TakenBinding, TakenCfBranch, TakenControlFlow};
pub use entry::{EntryComponent, emit_serve_entry_client, emit_serve_entry_event};
pub use helpers::{
    bind_field_idents, collect_deps_oxc, event_dom_type, is_component_tag, is_event_attr,
    is_html_attr, looks_like_ternary, sanitize_interp, split_ternary_parts,
};
pub use locale::{LocaleExport, emit_locale_runtime_module};
pub use row_kernel::try_emit_row_kernel_js;
pub use transpile::{transpile_ts, transpile_ts_with_map};

//! JavaScript CodeGenerator (oxc parse / transform / codegen).

mod ast_util;
mod deps;
mod emit;
mod emit_direct;
mod emit_ir;
mod entry;
/// Shared oxc parse for template expression snippets.
pub mod expr_parse;
/// Shared expression / attr helpers (also used by `vmz-compiler` structural build).
pub mod helpers;
mod locale;
mod module_rewrite;
mod print;
mod row_kernel;
mod transpile;

pub use deps::collect_template_deps;
pub use emit::{
    ServerBridge, emit_client_module, emit_entry_client, emit_server_module,
    rewrite_ts_spec_imports, rewrite_virtual_import,
};
pub use emit_direct::{ComponentHandlerCtx, emit_direct_create, emit_vmz_plan, is_direct_eligible};
pub use emit_ir::{IrDepCursor, TakenBinding, TakenCfBranch, TakenControlFlow};
pub use entry::{EntryComponent, emit_serve_entry_client, emit_serve_entry_event};
pub use expr_parse::{
    SnippetSpan, map_wrapped_span_to_snippet, print_template_expr, template_expr_root_span,
    template_expr_snippet_error, template_expr_snippet_error_with_span, template_expr_snippet_ok,
    wrap_template_expr_source,
};
pub use helpers::{
    HandlerResolution, bind_field_idents, collect_deps_oxc, event_dom_type, is_component_tag,
    is_event_attr, is_html_attr, looks_like_ternary, parse_this_method_call_arrow, sanitize_interp,
    single_field_binding_target, split_ternary_parts, wrap_event_handler_body,
};
pub use locale::{
    LocaleExport, LocaleTypedExport, LocaleTypedParam, emit_locale_runtime_module,
    emit_locale_typed_module,
};
pub use module_rewrite::{rewrite_module_specifiers, rewrite_module_specifiers_required};
pub use print::{EmittedJs, JsPrintOptions, print_js_program, print_js_source};
pub use row_kernel::try_emit_row_kernel_js;
pub use transpile::{transpile_ts, transpile_ts_printed, transpile_ts_with_map};

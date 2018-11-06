//! VMZ compiler: `.vmz` SFC + oxc analysis + Program Graph / Execution Plan + Workspace.
//!
//! Text artifact printers live in **`vmz-generator`** (CodeGenerators). This crate
//! orchestrates analyze → IR → `vmz_generator::*` → disk layout.
//!
//! Source layout (subsystems, not dump folders):
//! - [`parse`] - SFC / template / analyze (author format → `vmz-formatter`)
//! - [`pipeline`] - check / compile / graph / emit orchestration
//! - [`style`] - designs / TW / SCSS hooks (CSS print → generator)
//! - [`application`] - collection / mount
//! - [`session`] - Workspace / affected / plugin contributions
//! - [`tooling`] - rename / index / transaction / deployment proof
//! - [`native`] / [`miniprogram`] / [`platform`] - host contracts
//!
//! Explain / trace / causal replay: crate **`vmz-debugger`**.

#![deny(missing_docs)]
mod diagnostic;
pub mod error;

pub use error::{Error, Result, ResultExt};

pub mod application;
pub mod document;
pub mod locale;
pub mod miniprogram;
pub mod native;
pub mod parse;
pub mod pipeline;
pub mod platform;
pub mod session;
pub mod style;
pub mod tooling;

// --- Flat module path aliases (internal `crate::…` + napi) ---

pub use parse::{analyze, offset_index, sfc, template, transpile};

pub use pipeline::{
    check, compile, dep_graph, emit, emit_direct, emit_ir, field_rw, method_compose, plan_build,
    project, reactive_build, secrets, server_calls, server_slice, structural_build, virtual_server,
    write_barrier,
};

pub use style::designs;
pub use style::emit as style_emit;
pub use style::explain as style_explain;
pub use style::scss;
pub use style::token_diag as style_token_diag;
pub use style::tw;

pub use application::artifact as application_artifact;
pub use application::composition as application_composition;
pub use application::dev as application_dev;
pub use application::isolation as application_isolation;
pub use application::reloc as application_reloc;

pub use session::affected;
pub use session::graph as session_graph;
pub use session::plugin;
pub use session::workspace;

pub use tooling::cross_sfc;
pub use tooling::deployment_proof;
pub use tooling::rename;
pub use tooling::transaction;
pub use vmz_debugger::causal_replay;

pub use native::bridge as native_bridge;
pub use native::fullstack as native_fullstack;
pub use native::host as native_host;
pub use native::lifecycle as native_lifecycle;
pub use native::multi_platform;
pub use native::shell as native_shell;
pub use native::surface as native_surface;

pub use miniprogram::binding_event as miniprogram_binding_event;
pub use miniprogram::multi_adapter as miniprogram_multi_adapter;
pub use miniprogram::route_server_style as miniprogram_route_server_style;
pub use miniprogram::static_slice as miniprogram_static_slice;
pub use miniprogram::structure as miniprogram_structure;
pub use miniprogram::target as miniprogram_target;
pub use miniprogram::tooling_deploy as miniprogram_tooling_deploy;
pub use miniprogram::wechat_pack as miniprogram_wechat_pack;

pub use platform::conformance as cross_host_conformance;
pub use platform::delivery as delivery_proof;
pub use platform::executor as unified_executor;
pub use platform::lifecycle as lifecycle_recovery;
pub use platform::profile as host_profile;
pub use platform::solver as profile_solver;

// --- Crate root API (unchanged) ---

pub use affected::{AffectedPlan, AffectedUnit, plan_affected};
pub use analyze::{AnalyzedScript, analyze_script};
pub use application::check_applications;
pub use application_artifact::check_application_artifact_boundary;
pub use application_composition::check_application_host_composition;
pub use application_dev::check_application_dev_test_deploy;
pub use application_isolation::check_application_isolation;
pub use application_reloc::{
    check_application_relocatable, join_application_base, parse_application_base,
    relocate_manifest, relocate_manifest_json, sample_relocation_manifest, strip_application_base,
};
pub use check::{CheckOptions, CheckReport, check_path, check_project};
pub use compile::{
    CompileOptions, CompileReport, DEPLOYMENT_SCHEMA, DeploymentDocument, EmittedRoute,
    VmzMetaDocument, compile_path, compile_project, compile_project_with_dirty,
};
pub use designs::{
    DEFAULT_ACTIVATION_ATTR, DEFAULT_THEME_ID, DesignTokenEntry, DesignsBundle, StyleTheme,
    StyleThemeSummary, StyleThemeTable, StyleTokenLeaf, ThemeId, css_var_name, emit_designs_css,
    emit_style_theme_css, load_designs,
};
pub use diagnostic::{ReportedDiagnostic, Severity, parse_severity};
pub use emit::{ServerBridge, bind_field_idents, emit_client_js, emit_client_js_with_ir};
pub use offset_index::OffsetIndex;
pub use plugin::{
    ApplyContributionsReport, ContributionBatch, ContributionDiff, ContributionItem,
    ContributionKind, ContributionStore, ExplainContributionRow, ExplainContributionSurface,
    PLUGIN_PROTOCOL_V1, PLUGIN_TARGET_SCHEMA, PLUGIN_TARGETS_SUMMARY_SCHEMA, PluginIdentity,
    PluginStage, PluginTargetDocument, PluginTargetSummaryEntry, PluginTargetsSummary, Provenance,
    Rejection, sha256_hex_bytes,
};
pub use project::{VmzModuleKind, discover_vmz_files};
pub use reactive_build::{
    build_program_module, build_program_module_asts, build_program_module_with_server,
    build_program_module_with_server_asts, build_reactive_module,
    build_reactive_module_from_semantic, collect_concrete_expr_errors, collect_template_expr_errors,
    TemplateExprError,
};
pub use scss::{ScssCompiler, ScssCompilerHandle, ScssEmitRequest, ScssEmitResult};
pub use session_graph::{SessionClientCall, SessionGraph, SessionGraphDocument, SessionUnit};
pub use sfc::{
    DataBlock, ParsedVmz, ScriptBlock, ScriptKind, ScriptLanguage, SfcError, StyleBlock,
    StyleLanguage, TemplateBlock, parse_vmz,
};
pub use style_emit::{StyleContribution, StyleEmitReport, StyleLayer, emit_style_bundle};
pub use style_explain::explain_style;
pub use style_token_diag::{
    DIAG_UNKNOWN_DESIGN_TOKEN, DIAG_UNREFERENCED_GLOBAL_STYLE, DIAG_UNUSED_DESIGN_TOKEN,
    bare_utility, collect_style_import_specs, collect_vmz_css_var_refs,
    design_token_ref_from_utility, theme_leaf_ref_from_utility, validate_project_design_token_refs,
    validate_style_tw_design_token_refs, validate_unreferenced_global_styles,
    validate_unused_design_tokens, validate_vmz_css_var_refs,
};
pub use template::{
    AttrValue, ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg, EventTarget,
    IfBranch, SemanticIr, SemanticNode, SemanticProp, TemplateAttr, TemplateIr, TemplateNode,
    TemplateParseError, TemplateSpan, decode_html_entities, lower_concrete_to_ir,
    lower_concrete_to_semantic, parse_template, parse_template_asts, parse_template_concrete,
    template_parse_to_diagnostic,
};
pub use tw::{
    TwCompiler, TwCompilerHandle, TwEmitRequest, TwEmitResult, TwRegKind, TwRegistration,
    register_tw_from_parsed,
};
pub use vmz_protocol::SourceSpan;
pub use workspace::{
    BuildRequest, ChangeKind, FileChange, HandshakeError, PROTOCOL, ProtocolVersions,
    ProtocolVersionsOwned, Workspace, WorkspaceOptions, handshake,
};

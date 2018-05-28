//! VMZ compiler: `.vmz` SFC + oxc analysis + check/build.

mod affected;
mod analyze;
mod application;
mod application_artifact;
mod application_composition;
mod application_dev;
mod application_isolation;
mod application_reloc;
mod check;
mod compile;
mod dep_graph;
mod designs;
mod diagnostic;
mod dx_x1;
mod dx_x2;
mod dx_x3;
mod dx_x4;
mod dx_x5;
mod emit;
mod emit_direct;
mod emit_ir;
mod field_rw;
mod format;
mod method_compose;
pub mod mp0_target;
pub mod nw0_native_host;
pub mod nw1_shell;
pub mod nw2_bridge;
pub mod nw3_lifecycle;
pub mod nw4_fullstack;
pub mod nw5_surface;
pub mod nw6_multi_platform;
pub mod p0_profile;
pub mod p1_solver;
pub mod p2_executor;
pub mod p3_lifecycle;
pub mod p4_delivery;
pub mod p5_conformance;
mod plan_build;
mod plugin;
mod project;
mod reactive_build;
mod scss;
mod server_calls;
mod session_graph;
mod sfc;
mod structural_build;
mod style_emit;
mod style_explain;
mod style_token_diag;
mod template;
mod transpile;
mod tw;
mod virtual_server;
mod workspace;
mod write_barrier;

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
    CompileOptions, CompileReport, EmittedRoute, compile_path, compile_project,
    compile_project_with_dirty,
};
pub use designs::{
    DEFAULT_ACTIVATION_ATTR, DEFAULT_THEME_ID, DesignTokenEntry, DesignsBundle, StyleTheme,
    StyleThemeSummary, StyleThemeTable, StyleTokenLeaf, ThemeId, css_var_name, emit_designs_css,
    emit_style_theme_css, load_designs,
};
pub use diagnostic::{ReportedDiagnostic, Severity};
pub use emit::{ServerBridge, emit_client_js, emit_client_js_with_ir};
pub use format::{FormatOptions, FormatReport, format_path};
pub use plugin::{
    ApplyContributionsReport, ContributionBatch, ContributionDiff, ContributionItem,
    ContributionKind, ContributionStore, PLUGIN_PROTOCOL_V1, PluginIdentity, PluginStage,
    Provenance, Rejection, sha256_hex_bytes,
};
pub use project::{VmzModuleKind, discover_vmz_files};
pub use reactive_build::{build_program_module, build_program_module_with_server};
pub use scss::{ScssCompiler, ScssCompilerHandle, ScssEmitRequest, ScssEmitResult};
pub use session_graph::{SessionGraph, SessionUnit};
pub use sfc::{
    ParsedVmz, ScriptBlock, ScriptKind, SfcError, StyleBlock, StyleLanguage, TemplateBlock,
    parse_vmz,
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
pub use template::{AttrValue, TemplateAttr, TemplateIr, TemplateNode, parse_template};
pub use tw::{
    TwCompiler, TwCompilerHandle, TwEmitRequest, TwEmitResult, TwRegKind, TwRegistration,
    register_tw_from_parsed,
};
pub use workspace::{
    BuildRequest, ChangeKind, FileChange, HandshakeError, PROTOCOL, ProtocolVersions,
    ProtocolVersionsOwned, Workspace, WorkspaceOptions, handshake,
};

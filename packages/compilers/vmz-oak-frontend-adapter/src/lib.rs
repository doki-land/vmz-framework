//! VMZ ↔ Oaks frontend adapter.
//!
//! - **CST path** (`oak_cst`): Oak `VueParser` on template regions (format / highlight / LSP).
//! - **AST path** (`oak_ast`): Oak `VueBuilder` for compile-time concrete lowering (via `vmz-compiler`).
//!
//! See `规划设计/vmz/handoffs/2026-09-30-vmz-oak-nyar-frontend-integration.md`.

mod contract;
mod nyar_contract;
mod oak_ast;
mod oak_cst;
mod oak_script;

pub use contract::{
    BlockKind, ByteSpan, OakFrontendDiagnostic, ScriptRole, ScriptShellInput, SfcBlockRegion,
    SfcDocumentView, TemplateCstParse, TemplateShellInput,
};
pub use nyar_contract::{
    NyarAnalysisInput, NyarHttpRoute, NyarInternalType, NyarMember, NyarMemberKind,
    NyarProgramRole, NyarProgramUnit,
};
pub use oak_ast::{TemplateAstParse, parse_template_ast, require_template_ast};
pub use oak_cst::{format_cst_diagnostics, parse_template_cst, require_template_cst};
pub use oak_script::{ScriptAstParse, parse_script_ast, require_script_ast};

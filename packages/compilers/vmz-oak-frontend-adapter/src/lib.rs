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

pub use contract::{
    BlockKind, ByteSpan, OakFrontendDiagnostic, SfcBlockRegion, SfcDocumentView,
    TemplateCstParse, TemplateShellInput,
};
pub use nyar_contract::{
    NyarAnalysisInput, NyarHttpRoute, NyarInternalType, NyarMember, NyarMemberKind,
    NyarProgramRole, NyarProgramUnit,
};
pub use oak_ast::{parse_template_ast, require_template_ast, TemplateAstParse};
pub use oak_cst::{format_cst_diagnostics, parse_template_cst, require_template_cst};

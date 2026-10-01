//! VMZ ↔ Oaks frontend adapter.
//!
//! - **CST path** (`oak_cst`): Oak `VueParser` on template regions (format / highlight / LSP).
//! - **AST path** (`oak_ast`): Oak `VueBuilder` for compile-time concrete lowering (via `vmz-compiler`).
//!
//! Projects `.vmz` scripts into `NyarAnalysisInput` for Nyar analysis.
//! Conformance: `pnpm verify -- oak-frontend-smoke`.

mod contract;
mod nyar_contract;
mod oak_ast;
mod oak_cst;
mod oak_expr;
mod oak_script;

pub use contract::{
    BlockKind, ByteSpan, OakFrontendDiagnostic, ScriptRole, ScriptShellInput, SfcBlockRegion,
    SfcDocumentView, TemplateCstParse, TemplateShellInput,
};
pub use nyar_contract::{
    NyarAnalysisInput, NyarBindingKind, NyarHttpRoute, NyarImportBinding, NyarImportDecl,
    NyarImportKind, NyarInternalType, NyarMember, NyarMemberKind, NyarProgramRole, NyarProgramUnit,
};
pub use oak_ast::{TemplateAstParse, parse_template_ast, require_template_ast};
pub use oak_cst::{format_cst_diagnostics, parse_template_cst, require_template_cst};
pub use oak_expr::{ExpressionSnippetParse, parse_expression_snippet, require_expression_snippet};
pub use oak_script::{ScriptAstParse, parse_script_ast, require_script_ast};

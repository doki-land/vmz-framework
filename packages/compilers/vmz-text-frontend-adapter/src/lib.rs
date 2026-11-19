//! VMZ ↔ `data.text` frontend adapter.
//!
//! - **CST path** (`template_cst`): `VueParser` on template regions (format / highlight / LSP).
//! - **AST path** (`template_ast`): `VueBuilder` for compile-time concrete lowering (via `vmz-compiler`).
//!
//! Projects `.vmz` scripts into `NyarAnalysisInput` for Nyar analysis.
//! Conformance: `pnpm verify -- text-frontend-smoke`.

#![deny(missing_docs)]

mod contract;
mod nyar_contract;
mod template_ast;
mod template_cst;
mod text_expr;
mod script_ast;

pub use contract::{
    BlockKind, ByteSpan, FrontendDiagnostic, ScriptRole, ScriptShellInput, SfcBlockRegion,
    SfcDocumentView, TemplateCstParse, TemplateShellInput,
};
pub use nyar_contract::{
    NyarAnalysisInput, NyarBindingKind, NyarHttpRoute, NyarImportBinding, NyarImportDecl,
    NyarImportKind, NyarInternalType, NyarMember, NyarMemberKind, NyarProgramRole, NyarProgramUnit,
};
pub use template_ast::{TemplateAstParse, parse_template_ast, require_template_ast};
pub use template_cst::{format_cst_diagnostics, parse_template_cst, require_template_cst};
pub use text_expr::{ExpressionSnippetParse, parse_expression_snippet, require_expression_snippet};
pub use script_ast::{ScriptAstParse, parse_script_ast, require_script_ast};

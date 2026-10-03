//! Analyze script bodies through Oak TypeScript AST.

use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};
use vmz_types::{ComponentDecl, SourceRange};

use crate::field_rw::ForbiddenFactory;
use crate::parse::analyze_oak::{component_decl_from_root, forbidden_factories_from_root};
use crate::sfc::ScriptKind;

/// Script analysis result for one client or server body.
#[derive(Debug, Clone)]
pub struct AnalyzedScript {
    /// Whether this body was analyzed as client or server.
    pub kind: ScriptKind,
    /// Default-exported component declaration (Anonymous when missing).
    pub decl: ComponentDecl,
    /// Oak parse diagnostics.
    pub parse_errors: Vec<String>,
    /// Forbidden factory calls found in this script.
    pub forbidden_factories: Vec<ForbiddenFactory>,
}

/// Parse TypeScript once and lower the component and its read/write summaries.
pub fn analyze_script(kind: ScriptKind, source: &str) -> AnalyzedScript {
    let shell = ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: match kind {
            ScriptKind::Client => ScriptRole::Client,
            ScriptKind::Server => ScriptRole::Server,
        },
    };
    let parsed = parse_script_ast(&shell);
    let mut parse_errors: Vec<String> = parsed
        .diagnostics
        .iter()
        .map(|diagnostic| match diagnostic.span {
            Some(span) => format!("{} (byte {}..{})", diagnostic.message, span.start, span.end),
            None => diagnostic.message.clone(),
        })
        .collect();
    let mut decl = ComponentDecl::new("Anonymous", SourceRange::default(), SourceRange::default());
    let mut forbidden_factories = Vec::new();
    if parsed.ok {
        if let Some(root) = parsed.root.as_ref() {
            if let Some(component) = component_decl_from_root(root, source) {
                decl = component;
            }
            if kind == ScriptKind::Client {
                forbidden_factories = forbidden_factories_from_root(root);
            }
        }
    } else if parse_errors.is_empty() {
        parse_errors.push("Oak TypeScript analysis failed".to_string());
    }
    AnalyzedScript { kind, decl, parse_errors, forbidden_factories }
}

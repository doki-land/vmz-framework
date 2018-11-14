//! Thin `ExprPlan` ingress for template expressions (`0.1.19`).
//!
//! Expressions remain authored as text on Semantic AST; this plan captures oxc
//! root span + field reads + each-alias prop paths so scope fixtures do not
//! re-scan raw strings ad hoc.

use vmz_generator::{SnippetSpan, template_expr_root_span, template_expr_snippet_error};
use vmz_types::DepKey;

use crate::field_rw::{collect_each_alias_prop_paths, collect_template_dep_keys};
use crate::parse::template_common::TemplateParseError;

/// Planned template expression (text + snippet span + reads).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExprPlan {
    /// Trimmed expression source.
    pub source: String,
    /// oxc root span inside the trimmed snippet (`None` when empty / unparsed).
    pub snippet_span: Option<SnippetSpan>,
    /// Field dependency keys under `fields` (aliases in `scope` are excluded here).
    pub reads: Vec<DepKey>,
    /// Each-alias property paths (`tag.label` → `("tag", ["label"])`).
    pub alias_prop_paths: Vec<(String, Vec<String>)>,
}

/// Build an [`ExprPlan`] for a template expression under the given name scope.
pub fn plan_template_expr(
    expr: &str,
    fields: &[String],
    scope: &[String],
) -> Result<ExprPlan, TemplateParseError> {
    let source = expr.trim().to_string();
    if source.is_empty() {
        return Ok(ExprPlan {
            source,
            snippet_span: None,
            reads: Vec::new(),
            alias_prop_paths: Vec::new(),
        });
    }
    if let Some(msg) = template_expr_snippet_error(&source) {
        return Err(TemplateParseError {
            message: format!("invalid template expression `{source}`: {msg}"),
            offset: 0,
        });
    }
    let snippet_span = template_expr_root_span(&source);
    let reads = collect_template_dep_keys(&source, fields, scope);
    let mut alias_prop_paths = Vec::new();
    for alias in scope {
        for props in collect_each_alias_prop_paths(&source, alias) {
            alias_prop_paths.push((alias.clone(), props));
        }
    }
    Ok(ExprPlan { source, snippet_span, reads, alias_prop_paths })
}

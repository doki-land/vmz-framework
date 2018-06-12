//! Rust-flavor Server Language DSL (subset — not full rustc syntax).
//!
//! Lowers `struct` / `impl` capability methods into [`ComponentDecl`] so the
//! shared Server DSL semantics match the TS `export default class` path.

use oxc_span::Span;

use vmz_types::{ComponentDecl, MethodDecl};

use crate::sfc::ScriptKind;

use super::analyze::AnalyzedScript;

/// Analyze a rust-flavor `<script server lang="rust">` body.
pub fn analyze_rust_server_dsl(source: &str) -> AnalyzedScript {
    let mut parse_errors = Vec::new();
    let type_name = match extract_server_type_name(source) {
        Some(n) => n,
        None => {
            parse_errors.push(
                "rust server DSL must declare `pub struct TypeName;` (or `struct TypeName;`)"
                    .to_string(),
            );
            "Anonymous".to_string()
        }
    };

    if source.contains("fn main") {
        parse_errors.push(
            "rust server DSL forbids `fn main` — application entry belongs in handwritten crates"
                .to_string(),
        );
    }
    if source.contains("#[proc_macro") || source.contains("proc_macro!") {
        parse_errors.push(
            "rust server DSL forbids proc-macro authoring — use handwritten crates".to_string(),
        );
    }

    let methods = extract_capability_methods(source);
    if methods.is_empty() && parse_errors.is_empty() {
        parse_errors.push(
            "rust server DSL must declare at least one `pub async fn` / `async fn` capability method"
                .to_string(),
        );
    }

    let mut decl = ComponentDecl::new(type_name, Span::default());
    decl.methods = methods;

    AnalyzedScript {
        kind: ScriptKind::Server,
        decl,
        parse_errors,
        forbidden_factories: Vec::new(),
    }
}

/// Emit rustc-facing glue for one server unit + JSON capability table.
pub fn emit_rust_server_unit(
    module_id: &str,
    analyzed: &AnalyzedScript,
    dsl_source: &str,
) -> (String, String) {
    vmz_generator::lang::emit_rust_server_unit(module_id, &analyzed.decl, dsl_source)
}

fn extract_server_type_name(source: &str) -> Option<String> {
    for line in source.lines() {
        let t = line.trim();
        let rest = if let Some(r) = t.strip_prefix("pub struct ") {
            r
        } else if let Some(r) = t.strip_prefix("struct ") {
            r
        } else {
            continue;
        };
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            return Some(name);
        }
    }
    None
}

fn extract_capability_methods(source: &str) -> Vec<MethodDecl> {
    let mut out = Vec::new();
    for line in source.lines() {
        let t = line.trim();
        let is_async = t.contains("async fn ");
        let Some(after_fn) = t.split("fn ").nth(1) else {
            continue;
        };
        // Skip `fn main`
        let name: String = after_fn
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() || name == "main" || name == "new" {
            continue;
        }
        // Only treat as capability if it looks like an impl method line
        if !(t.starts_with("pub ") || t.starts_with("async ") || t.starts_with("fn ")) {
            continue;
        }
        out.push(MethodDecl {
            name,
            is_async,
            is_static: false,
            is_private: false,
            http: None,
            reads: Vec::new(),
            writes: Vec::new(),
            calls: Vec::new(),
            opaque_callee: false,
            star_reasons: Vec::new(),
            span: Span::default(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_struct_and_async_methods() {
        let src = r#"
use panel::server::store;

pub struct KernelServer;

impl KernelServer {
    pub async fn bootstrap(&self, token: Option<String>) -> String {
        store::bootstrap(token).await
    }

    pub async fn login(&self, user: String, password: String) -> String {
        store::login(user, password).await
    }
}
"#;
        let an = analyze_rust_server_dsl(src);
        assert!(an.parse_errors.is_empty(), "{:?}", an.parse_errors);
        assert_eq!(an.decl.name, "KernelServer");
        let names: Vec<_> = an.decl.methods.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["bootstrap", "login"]);
        assert!(an.decl.methods.iter().all(|m| m.is_async));
    }

    #[test]
    fn rejects_fn_main() {
        let src = r#"
pub struct S;
impl S {
    pub async fn ok(&self) {}
}
fn main() {}
"#;
        let an = analyze_rust_server_dsl(src);
        assert!(an.parse_errors.iter().any(|e| e.contains("fn main")));
    }
}

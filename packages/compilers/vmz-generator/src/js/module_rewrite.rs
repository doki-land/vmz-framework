//! Rewrite ESM module specifiers (Oak-primary span splice; oxc AST mutate fallback).

use oak_typescript::ast::{Expression, ExpressionKind, Statement};
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ExportAllDeclaration, ExportFromDeclaration, Expression as OxcExpression, ImportDeclaration,
    StringLiteral,
};
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};
use oxc_str::Str;
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};

/// Rewrite `import` / `export … from` / `import()` module strings with `map`.
///
/// Prefers Oak TypeScript AST + in-place specifier splice (preserves surrounding
/// formatting). Falls back to oxc parse/mutate/codegen when Oak cannot lower a root.
///
/// Returns `None` only when both Oak and oxc fail to parse as a module.
pub fn rewrite_module_specifiers(
    source: &str,
    mut map: impl FnMut(&str) -> Option<String>,
) -> Option<String> {
    if let Some(out) = rewrite_module_specifiers_via_oak(source, &mut map) {
        return Some(out);
    }
    rewrite_module_specifiers_via_oxc(source, map)
}

/// Like [`rewrite_module_specifiers`], panicking when parse fails.
pub fn rewrite_module_specifiers_required(
    source: &str,
    map: impl FnMut(&str) -> Option<String>,
    context: &str,
) -> String {
    rewrite_module_specifiers(source, map).unwrap_or_else(|| {
        panic!(
            "vmz-generator: failed to parse module for specifier rewrite ({context}; {} bytes)",
            source.len()
        );
    })
}

fn rewrite_module_specifiers_via_oak(
    source: &str,
    map: &mut dyn FnMut(&str) -> Option<String>,
) -> Option<String> {
    let shell = ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    };
    let parsed = parse_script_ast(&shell);
    let root = parsed.root.as_ref()?;
    if root.statements.is_empty() && !source.trim().is_empty() {
        return None;
    }

    let mut patches: Vec<(usize, usize, String)> = Vec::new();
    for stmt in &root.statements {
        collect_stmt_spec_patches(source, stmt, map, &mut patches);
    }
    Some(apply_span_patches(source, &mut patches))
}

fn collect_stmt_spec_patches(
    source: &str,
    stmt: &Statement,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    match stmt {
        Statement::ImportDeclaration(imp) => {
            push_spec_patch(source, imp.span.start, imp.span.end, &imp.module_specifier, map, out);
        }
        Statement::ExportDeclaration(exp) => {
            if let Some(spec) = &exp.source {
                push_spec_patch(source, exp.span.start, exp.span.end, spec, map, out);
            }
            if let Some(inner) = exp.declaration.as_deref() {
                collect_stmt_spec_patches(source, inner, map, out);
            }
        }
        Statement::ExpressionStatement(es) => {
            collect_expr_spec_patches(source, &es.expression, map, out);
        }
        Statement::VariableDeclaration(v) => {
            if let Some(init) = &v.value {
                collect_expr_spec_patches(source, init, map, out);
            }
        }
        Statement::ReturnStatement(r) => {
            if let Some(e) = &r.argument {
                collect_expr_spec_patches(source, e, map, out);
            }
        }
        Statement::BlockStatement(b) => {
            for s in &b.statements {
                collect_stmt_spec_patches(source, s, map, out);
            }
        }
        Statement::IfStatement(i) => {
            collect_expr_spec_patches(source, &i.test, map, out);
            collect_stmt_spec_patches(source, &i.consequent, map, out);
            if let Some(alt) = &i.alternate {
                collect_stmt_spec_patches(source, alt, map, out);
            }
        }
        Statement::FunctionDeclaration(f) => {
            for s in &f.body {
                collect_stmt_spec_patches(source, s, map, out);
            }
        }
        Statement::ClassDeclaration(c) => {
            for m in &c.body {
                if let oak_typescript::ast::ClassMember::Method { body, .. } = m {
                    for s in body {
                        collect_stmt_spec_patches(source, s, map, out);
                    }
                }
            }
        }
        _ => {}
    }
}

fn collect_expr_spec_patches(
    source: &str,
    expr: &Expression,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    match expr.kind.as_ref() {
        ExpressionKind::ImportExpression { module_specifier } => {
            push_expr_string_spec_patch(source, module_specifier, map, out);
        }
        ExpressionKind::CallExpression { func, args } => {
            // Oaks lowers `import("…")` either as CallExpression(Identifier("import"), [lit])
            // or with the module string as the callee and zero args.
            if matches!(func.kind.as_ref(), ExpressionKind::Identifier(n) if n == "import") {
                if let Some(first) = args.first() {
                    push_expr_string_spec_patch(source, first, map, out);
                } else {
                    scan_span_for_quoted_specs(source, expr.span.start, expr.span.end, map, out);
                }
            } else if args.is_empty() {
                if let ExpressionKind::StringLiteral(spec) = func.kind.as_ref() {
                    push_string_spec_patch(source, func.span.start, func.span.end, spec, map, out);
                } else {
                    collect_expr_spec_patches(source, func, map, out);
                }
            } else {
                collect_expr_spec_patches(source, func, map, out);
                for a in args {
                    collect_expr_spec_patches(source, a, map, out);
                }
            }
        }
        ExpressionKind::AssignmentExpression { left, right, .. } => {
            collect_expr_spec_patches(source, left, map, out);
            collect_expr_spec_patches(source, right, map, out);
        }
        ExpressionKind::BinaryExpression { left, right, .. } => {
            collect_expr_spec_patches(source, left, map, out);
            collect_expr_spec_patches(source, right, map, out);
        }
        ExpressionKind::MemberExpression { object, property, .. } => {
            collect_expr_spec_patches(source, object, map, out);
            collect_expr_spec_patches(source, property, map, out);
        }
        ExpressionKind::AwaitExpression(inner) | ExpressionKind::SpreadElement(inner) => {
            collect_expr_spec_patches(source, inner, map, out);
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for e in elements {
                collect_expr_spec_patches(source, e, map, out);
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for p in properties {
                match p {
                    oak_typescript::ast::ObjectProperty::Property { value, .. } => {
                        collect_expr_spec_patches(source, value, map, out);
                    }
                    oak_typescript::ast::ObjectProperty::Spread(e) => {
                        collect_expr_spec_patches(source, e, map, out);
                    }
                }
            }
        }
        ExpressionKind::ArrowFunction { body, .. } => {
            collect_stmt_spec_patches(source, body, map, out);
        }
        ExpressionKind::FunctionExpression { body, .. } => {
            for s in body {
                collect_stmt_spec_patches(source, s, map, out);
            }
        }
        _ => {}
    }
}

fn push_expr_string_spec_patch(
    source: &str,
    expr: &Expression,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    if let ExpressionKind::StringLiteral(spec) = expr.kind.as_ref() {
        push_string_spec_patch(source, expr.span.start, expr.span.end, spec, map, out);
    } else {
        collect_expr_spec_patches(source, expr, map, out);
    }
}

fn push_string_spec_patch(
    source: &str,
    span_start: usize,
    span_end: usize,
    spec: &str,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    let Some(next) = map(spec) else {
        return;
    };
    let start = span_start.min(source.len());
    let end = span_end.min(source.len());
    let quote = source.as_bytes().get(start).copied().unwrap_or(b'"') as char;
    if quote == '"' || quote == '\'' {
        out.push((start, end, format!("{quote}{next}{quote}")));
        return;
    }
    if let Some((start, end, quote)) = find_quoted_spec(source, span_start, span_end, spec) {
        out.push((start, end, format!("{quote}{next}{quote}")));
    }
}

fn push_spec_patch(
    source: &str,
    span_start: usize,
    span_end: usize,
    spec: &str,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    push_string_spec_patch(source, span_start, span_end, spec, map, out);
}

fn scan_span_for_quoted_specs(
    source: &str,
    span_start: usize,
    span_end: usize,
    map: &mut dyn FnMut(&str) -> Option<String>,
    out: &mut Vec<(usize, usize, String)>,
) {
    let end = span_end.min(source.len());
    let start = span_start.min(end);
    let bytes = source[start..end].as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let quote = bytes[i];
        if quote != b'"' && quote != b'\'' {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < bytes.len() {
            if bytes[j] == b'\\' {
                j = (j + 2).min(bytes.len());
                continue;
            }
            if bytes[j] == quote {
                let abs_start = start + i;
                let abs_end = start + j + 1;
                let spec = &source[abs_start + 1..abs_end - 1];
                if let Some(next) = map(spec) {
                    let q = quote as char;
                    out.push((abs_start, abs_end, format!("{q}{next}{q}")));
                }
                i = j + 1;
                break;
            }
            j += 1;
        }
        if j >= bytes.len() {
            break;
        }
    }
}

fn find_quoted_spec(
    source: &str,
    span_start: usize,
    span_end: usize,
    spec: &str,
) -> Option<(usize, usize, char)> {
    let end = span_end.min(source.len());
    let start = span_start.min(end);
    let slice = &source[start..end];
    for quote in ['"', '\''] {
        let needle = format!("{quote}{spec}{quote}");
        if let Some(rel) = slice.rfind(&needle) {
            let abs = start + rel;
            return Some((abs, abs + needle.len(), quote));
        }
    }
    None
}

fn apply_span_patches(source: &str, patches: &mut [(usize, usize, String)]) -> String {
    patches.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = source.to_string();
    for (start, end, text) in patches.iter() {
        if *end <= out.len() && *start <= *end {
            out.replace_range(*start..*end, text);
        }
    }
    out
}

fn rewrite_module_specifiers_via_oxc(
    source: &str,
    mut map: impl FnMut(&str) -> Option<String>,
) -> Option<String> {
    let allocator = Allocator::default();
    let mut program = {
        let ret = Parser::new(&allocator, source, SourceType::mjs()).parse();
        if ret.panicked {
            return None;
        }
        ret.program
    };

    struct Rewriter<'a, F> {
        ast: AstBuilder<'a>,
        map: F,
    }

    impl<'a, F> Rewriter<'a, F>
    where
        F: FnMut(&str) -> Option<String>,
    {
        fn rewrite_lit(&mut self, lit: &mut StringLiteral<'a>) {
            if let Some(next) = (self.map)(lit.value.as_str()) {
                *lit =
                    StringLiteral::new(SPAN, Str::from_str_in(&next, &self.ast), None, &self.ast);
            }
        }
    }

    impl<'a, F> VisitMut<'a> for Rewriter<'a, F>
    where
        F: FnMut(&str) -> Option<String>,
    {
        fn visit_import_declaration(&mut self, decl: &mut ImportDeclaration<'a>) {
            self.rewrite_lit(&mut decl.source);
            walk_mut::walk_import_declaration(self, decl);
        }

        fn visit_export_all_declaration(&mut self, decl: &mut ExportAllDeclaration<'a>) {
            self.rewrite_lit(&mut decl.source);
            walk_mut::walk_export_all_declaration(self, decl);
        }

        fn visit_export_from_declaration(&mut self, decl: &mut ExportFromDeclaration<'a>) {
            self.rewrite_lit(&mut decl.source);
            walk_mut::walk_export_from_declaration(self, decl);
        }

        fn visit_import_expression(&mut self, expr: &mut oxc_ast::ast::ImportExpression<'a>) {
            if let OxcExpression::StringLiteral(lit) = &mut expr.source {
                self.rewrite_lit(lit);
            } else {
                walk_mut::walk_expression(self, &mut expr.source);
            }
            if let Some(options) = expr.options.as_mut() {
                walk_mut::walk_expression(self, options);
            }
        }
    }

    let mut visitor = Rewriter { ast: AstBuilder::new(&allocator), map: &mut map };
    visitor.visit_program(&mut program);
    Some(Codegen::new().build(&program).code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_static_and_dynamic_imports() {
        let src = r#"
import a from "vmz:runtime";
import "./foo.ts";
export { b } from './bar.tsx';
export * from "vmz:dom";
const x = import("./baz.ts");
"#;
        let out = rewrite_module_specifiers(src, |spec| {
            if spec == "vmz:runtime" {
                Some("./runtime.js".into())
            } else if spec == "vmz:dom" {
                Some("./dom.js".into())
            } else if let Some(stem) =
                spec.strip_suffix(".tsx").or_else(|| spec.strip_suffix(".ts"))
            {
                Some(format!("{stem}.js"))
            } else {
                None
            }
        })
        .expect("parse");
        assert!(out.contains("./runtime.js"), "{out}");
        assert!(out.contains("./dom.js"), "{out}");
        assert!(out.contains("./foo.js"), "{out}");
        assert!(out.contains("./bar.js"), "{out}");
        assert!(out.contains("./baz.js"), "{out}");
        assert!(!out.contains("vmz:runtime"), "{out}");
        assert!(!out.contains(".tsx"), "{out}");
        assert!(!out.contains(".ts\""), "{out}");
        assert!(!out.contains(".ts'"), "{out}");
    }

    #[test]
    fn oak_rewrites_zero_arg_dynamic_import() {
        let src = "const x = import(\"./baz.ts\");\n";
        let out = rewrite_module_specifiers(src, |spec| {
            spec.strip_suffix(".ts").map(|stem| format!("{stem}.js"))
        })
        .expect("parse");
        assert!(out.contains("./baz.js"), "{out}");
        assert!(!out.contains(".ts"), "{out}");
    }

    #[test]
    fn oak_path_preserves_surrounding_layout() {
        let src = "import a from \"vmz:runtime\";\n";
        let out = rewrite_module_specifiers_via_oak(src, &mut |spec| {
            (spec == "vmz:runtime").then(|| "./runtime.js".into())
        })
        .expect("oak");
        assert_eq!(out, "import a from \"./runtime.js\";\n");
    }
}

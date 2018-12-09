//! Rewrite ESM module specifiers via oxc AST (no string `.replace` on import text).

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ExportAllDeclaration, ExportFromDeclaration, Expression, ImportDeclaration, StringLiteral,
};
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};
use oxc_str::Str;

/// Rewrite `import` / `export … from` / `import()` module strings with `map`.
///
/// Returns `None` only when the source fails to parse as a module.
pub fn rewrite_module_specifiers(
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
            if let Expression::StringLiteral(lit) = &mut expr.source {
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

/// Like [`rewrite_module_specifiers`], panicking when parse fails.
pub fn rewrite_module_specifiers_required(
    source: &str,
    map: impl FnMut(&str) -> Option<String>,
    context: &str,
) -> String {
    rewrite_module_specifiers(source, map).unwrap_or_else(|| {
        panic!(
            "vmz-generator: oxc failed to parse module for specifier rewrite ({context}; {} bytes)",
            source.len()
        );
    })
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
}

//! Shared oxc AstBuilder helpers for JsCodeGenerator.

use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::{
    ArrayExpressionElement, AssignmentTarget, Expression, IdentifierName, ObjectPropertyKind,
    Program, PropertyKey, PropertyKind, Statement,
};
use oxc_ast::builder::AstBuilder;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};
use oxc_str::{Ident, Str};
use oxc_syntax::number::NumberBase;
use oxc_syntax::operator::AssignmentOperator;

/// Arena-backed builders for codegen snippets.
pub struct JsAst<'a> {
    /// Underlying oxc builder (also the allocator via `Deref`).
    pub ast: AstBuilder<'a>,
}

impl<'a> JsAst<'a> {
    /// Create builders on `allocator`.
    pub fn new(allocator: &'a Allocator) -> Self {
        Self { ast: AstBuilder::new(allocator) }
    }

    /// `"..."`.
    pub fn str_lit(&self, s: &str) -> Expression<'a> {
        Expression::new_string_literal(SPAN, Str::from_str_in(s, &self.ast), None, &self.ast)
    }

    /// Decimal number literal.
    pub fn num_lit(&self, n: u32) -> Expression<'a> {
        Expression::new_numeric_literal(SPAN, f64::from(n), None, NumberBase::Decimal, &self.ast)
    }

    /// `null`.
    pub fn null_lit(&self) -> Expression<'a> {
        Expression::new_null_literal(SPAN, &self.ast)
    }

    /// `true` / `false`.
    pub fn bool_lit(&self, v: bool) -> Expression<'a> {
        Expression::new_boolean_literal(SPAN, v, &self.ast)
    }

    /// Identifier reference.
    pub fn ident(&self, name: &str) -> Expression<'a> {
        Expression::new_identifier(SPAN, Ident::from_str_in(name, &self.ast), &self.ast)
    }

    /// `{ key: value, ... }` property.
    pub fn prop(&self, key: &str, value: Expression<'a>) -> ObjectPropertyKind<'a> {
        ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            PropertyKey::new_static_identifier(SPAN, Ident::from_str_in(key, &self.ast), &self.ast),
            value,
            false,
            false,
            false,
            &self.ast,
        )
    }

    /// String-key property (`"name": value`) when key is not a safe ident.
    pub fn str_key_prop(&self, key: &str, value: Expression<'a>) -> ObjectPropertyKind<'a> {
        ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            PropertyKey::from(self.str_lit(key)),
            value,
            false,
            false,
            false,
            &self.ast,
        )
    }

    /// `[...]` of string literals.
    pub fn str_array(&self, items: &[&str]) -> Expression<'a> {
        let mut elements = ArenaVec::with_capacity_in(items.len(), &self.ast);
        for s in items {
            elements.push(ArrayExpressionElement::from(self.str_lit(s)));
        }
        Expression::new_array_expression(SPAN, elements, &self.ast)
    }

    /// `[...]` of u32 literals.
    pub fn u32_array(&self, ids: &[u32]) -> Expression<'a> {
        let mut elements = ArenaVec::with_capacity_in(ids.len(), &self.ast);
        for id in ids {
            elements.push(ArrayExpressionElement::from(self.num_lit(*id)));
        }
        Expression::new_array_expression(SPAN, elements, &self.ast)
    }

    /// Object expression from properties.
    pub fn object(&self, props: ArenaVec<'a, ObjectPropertyKind<'a>>) -> Expression<'a> {
        Expression::new_object_expression(SPAN, props, &self.ast)
    }

    /// `left.name = value` as a statement (`left` is an identifier).
    pub fn assign_member_stmt(
        &self,
        object: &str,
        member: &str,
        value: Expression<'a>,
    ) -> Statement<'a> {
        let left = AssignmentTarget::new_static_member_expression(
            SPAN,
            self.ident(object),
            IdentifierName::new(SPAN, Ident::from_str_in(member, &self.ast), &self.ast),
            false,
            &self.ast,
        );
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            left,
            value,
            &self.ast,
        );
        Statement::new_expression_statement(SPAN, assign, &self.ast)
    }

    /// Print a single expression (no trailing semicolon).
    pub fn print_expr(&self, expr: Expression<'a>) -> String {
        let mut codegen = Codegen::new();
        codegen.print_expression(&expr);
        codegen.into_source_text()
    }

    /// Print statements as a Program (script).
    pub fn print_stmts(&self, stmts: ArenaVec<'a, Statement<'a>>) -> String {
        let program = Program::new(
            SPAN,
            SourceType::cjs(),
            "",
            ArenaVec::new_in(&self.ast),
            None,
            ArenaVec::new_in(&self.ast),
            stmts,
            &self.ast,
        );
        Codegen::new().build(&program).code
    }
}

/// Print a JS string literal via oxc codegen (correct escapes; not Rust `Debug`).
pub fn js_string_literal(s: &str) -> String {
    let allocator = Allocator::default();
    let b = JsAst::new(&allocator);
    b.print_expr(b.str_lit(s))
}

/// `export default Name;`
pub fn print_export_default(name: &str) -> String {
    let src = format!("export default {name};\n");
    oxc_reprint_module(&src).unwrap_or(src)
}

/// Parse module / script source and re-print with oxc codegen.
///
/// Used as a formatting + escape gate for transitional text-built snippets.
pub fn oxc_reprint_module(source: &str) -> Option<String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::mjs()).parse();
    if parsed.panicked {
        return None;
    }
    Some(Codegen::new().build(&parsed.program).code)
}

/// Print a single assignment statement `name.member = value` with leading newline.
pub fn print_member_assign(
    name: &str,
    member: &str,
    build: impl for<'a> FnOnce(&'a JsAst<'a>) -> Expression<'a>,
) -> String {
    let allocator = Allocator::default();
    let b = JsAst::new(&allocator);
    let value = build(&b);
    let stmt = b.assign_member_stmt(name, member, value);
    let body = ArenaVec::from_iter_in([stmt], &b.ast);
    format!("\n{}", b.print_stmts(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_lit_roundtrips_through_codegen() {
        let code = print_member_assign("Comp", "__flag", |b| b.str_lit("a\"b\nc"));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, code.trim(), SourceType::cjs()).parse();
        assert!(!parsed.panicked, "must re-parse: {code}");
        assert!(code.contains("__flag"));
    }

    #[test]
    fn js_string_literal_escapes_quotes_and_newlines() {
        let lit = js_string_literal("a\"b\nc</script>");
        assert!(lit.starts_with('"') && lit.ends_with('"'), "{lit}");
        let allocator = Allocator::default();
        let wrapped = format!("x = {lit};");
        let parsed = Parser::new(&allocator, &wrapped, SourceType::cjs()).parse();
        assert!(!parsed.panicked, "must re-parse: {wrapped}");
    }

    #[test]
    fn method_rw_shape_reparses() {
        let allocator = Allocator::default();
        let b = JsAst::new(&allocator);
        let reads = ["count", r#"path["x"]"#];
        let entry = ArenaVec::from_iter_in(
            [
                b.prop("reads", b.str_array(&reads)),
                b.prop("opaque", b.bool_lit(false)),
                b.prop("async", b.bool_lit(true)),
            ],
            &b.ast,
        );
        let mut props = ArenaVec::new_in(&b.ast);
        props.push(b.str_key_prop("onClick", b.object(entry)));
        let stmt = b.assign_member_stmt("Comp", "__vmzMethodRw", b.object(props));
        let body = ArenaVec::from_iter_in([stmt], &b.ast);
        let code = b.print_stmts(body);
        let parsed = Parser::new(&allocator, &code, SourceType::cjs()).parse();
        assert!(!parsed.panicked, "must re-parse: {code}");
        assert!(code.contains("__vmzMethodRw"));
        assert!(code.contains("onClick"));
    }
}

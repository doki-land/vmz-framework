//! Template expression -> transitional dep strings (oxc).

use oxc_ast::ast::{Expression, MemberExpression};
use oxc_ast_visit::{Visit, walk};
use oxc_span::SourceType;
use vmz_types::{DepKey, DepPath, PathSegment};

/// Template expression deps via oxc (stable DepKey strings).
pub fn collect_template_deps(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    collect_template_dep_keys(expr, fields, scope)
        .into_iter()
        .map(|k| k.to_stable_string())
        .collect()
}

/// Same as [`collect_template_deps`] but returns structured [`DepKey`]s.
pub fn collect_template_dep_keys(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || fields.is_empty() {
        return Vec::new();
    }
    let src = super::expr_parse::wrap_template_expr_source(trimmed);
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() || ret.panicked {
        return collect_template_deps_scan(trimmed, fields, scope);
    }
    let mut v =
        TemplateDepVisitor { fields: fields.to_vec(), scope: scope.to_vec(), deps: Vec::new() };
    v.visit_program(&ret.program);
    v.deps
}

struct TemplateDepVisitor {
    fields: Vec<String>,
    scope: Vec<String>,
    deps: Vec<DepKey>,
}

impl TemplateDepVisitor {
    fn push(&mut self, key: DepKey) {
        let s = key.to_stable_string();
        if !self.deps.iter().any(|d| d.to_stable_string() == s) {
            self.deps.push(key);
        }
    }

    fn is_field(&self, name: &str) -> bool {
        self.fields.iter().any(|f| f == name)
    }

    fn in_scope(&self, name: &str) -> bool {
        self.scope.iter().any(|s| s == name)
    }

    fn member_to_dep(&self, me: &MemberExpression<'_>) -> Option<DepKey> {
        let (root, segs) = path_from_member(me)?;
        if self.in_scope(&root) || !self.is_field(&root) {
            return None;
        }
        Some(DepKey::path(DepPath { root, segments: segs }))
    }
}

impl<'a> Visit<'a> for TemplateDepVisitor {
    fn visit_member_expression(&mut self, it: &MemberExpression<'a>) {
        if let Some(key) = self.member_to_dep(it) {
            self.push(key);
            if let MemberExpression::ComputedMemberExpression(c) = it {
                self.visit_expression(&c.expression);
            }
            return;
        }
        walk::walk_member_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'a>) {
        let name = it.name.as_str();
        if self.in_scope(name) || !self.is_field(name) {
            return;
        }
        self.push(DepKey::field(name));
    }
}

fn path_from_member(me: &MemberExpression<'_>) -> Option<(String, Vec<PathSegment>)> {
    match me {
        MemberExpression::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        MemberExpression::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn path_from_object(expr: &Expression<'_>) -> Option<(String, Vec<PathSegment>)> {
    match expr {
        Expression::Identifier(id) => Some((id.name.to_string(), Vec::new())),
        Expression::ParenthesizedExpression(p) => path_from_object(&p.expression),
        Expression::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        Expression::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        Expression::ChainExpression(c) => path_from_chain_element(&c.expression),
        _ => None,
    }
}

fn path_from_chain_element(
    el: &oxc_ast::ast::ChainElement<'_>,
) -> Option<(String, Vec<PathSegment>)> {
    match el {
        oxc_ast::ast::ChainElement::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        oxc_ast::ast::ChainElement::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        _ => None,
    }
}

fn path_seg_from_index_expr(expr: &Expression<'_>) -> Option<PathSegment> {
    match expr {
        Expression::NumericLiteral(n) if n.value.fract() == 0.0 && n.value >= 0.0 => {
            Some(PathSegment::StaticIndex(n.value as usize))
        }
        Expression::StringLiteral(s) => Some(PathSegment::Ident(s.value.as_str().to_string())),
        Expression::Identifier(id) => Some(PathSegment::DynamicIndex(id.name.to_string())),
        Expression::ParenthesizedExpression(p) => path_seg_from_index_expr(&p.expression),
        _ => None,
    }
}

fn collect_template_deps_scan(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let mut deps: Vec<DepKey> = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            let preceded_by_dot = start > 0 && chars[start - 1] == '.';
            if preceded_by_dot
                || scope.iter().any(|s| s == &ident)
                || !fields.iter().any(|f| f == &ident)
            {
                continue;
            }
            let key = DepKey::field(&ident);
            if !deps.iter().any(|d| d.to_stable_string() == key.to_stable_string()) {
                deps.push(key);
            }
        } else {
            i += 1;
        }
    }
    deps
}

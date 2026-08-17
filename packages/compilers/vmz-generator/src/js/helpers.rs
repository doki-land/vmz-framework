//! Shared JS emit helpers (events, field binding, ternary split).

use oxc_span::GetSpan;

/// Trusted raw HTML binding (`html={expr}`) — not a DOM attribute.
pub fn is_html_attr(name: &str) -> bool {
    name == "html"
}

/// True when the attr name is an event (`onClick` / `@click`).
pub fn is_event_attr(name: &str) -> bool {
    if name.starts_with('@') {
        return name.len() > 1;
    }
    let bytes = name.as_bytes();
    bytes.len() >= 3 && bytes[..2].eq_ignore_ascii_case(b"on") && bytes[2].is_ascii_uppercase()
}

/// DOM event type from `onClick` / `@click` / `@click.stop` / `on:click`.
pub fn event_dom_type(name: &str) -> String {
    let raw = if let Some(rest) = name.strip_prefix('@') {
        rest
    } else if let Some(rest) = name.strip_prefix("on:") {
        rest
    } else if name.len() >= 3 && name.as_bytes()[..2].eq_ignore_ascii_case(b"on") {
        &name[2..]
    } else {
        name
    };
    raw.split('.').next().unwrap_or(raw).to_ascii_lowercase()
}

/// Strip leading `this.` from interpolation expressions.
pub fn sanitize_interp(expr: &str) -> String {
    let e = expr.trim();
    e.strip_prefix("this.").unwrap_or(e).to_string()
}

/// Component tags are PascalCase.
pub fn is_component_tag(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// Heuristic: expression looks like a ternary.
pub fn looks_like_ternary(expr: &str) -> bool {
    let chars: Vec<char> = expr.chars().collect();
    for i in 0..chars.len() {
        if chars[i] == '?' && (i + 1 >= chars.len() || chars[i + 1] != '.') {
            return true;
        }
    }
    false
}

/// Top-level `a ? b : c` → (test, consequent, alternate).
pub fn split_ternary_parts(expr: &str) -> Option<(String, String, String)> {
    let src = format!("({expr})");
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
        return None;
    }
    let body = ret.program.body.first()?;
    let oxc_ast::ast::Statement::ExpressionStatement(es) = body else {
        return None;
    };
    let mut top = &es.expression;
    while let oxc_ast::ast::Expression::ParenthesizedExpression(p) = top {
        top = &p.expression;
    }
    let oxc_ast::ast::Expression::ConditionalExpression(cond) = top else {
        return None;
    };
    let slice = |span: oxc_span::Span| -> Option<String> {
        let s = span.start as usize;
        let e = span.end as usize;
        if s < e && e <= src.len() {
            Some(src[s..e].trim().to_string())
        } else {
            None
        }
    };
    let test = slice(cond.test.span())?;
    let cons = slice(cond.consequent.span())?;
    let alt = slice(cond.alternate.span())?;
    if test.is_empty() || cons.is_empty() || alt.is_empty() {
        return None;
    }
    Some((test, cons, alt))
}

/// Collect deps via oxc (generator-owned).
pub fn collect_deps_oxc(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    super::deps::collect_template_deps(expr, fields, scope)
}

/// Rewrite bare field idents to `this.field` via oxc parse + VisitMut + codegen.
///
/// String / template literals are untouched by the AST walk (unlike the old
/// char scanner). Falls back to the legacy scanner only when the expression
/// fails to parse.
pub fn bind_field_idents(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> String {
    if fields.is_empty() && scope.is_empty() && aliases.is_empty() {
        return expr.trim().to_string();
    }
    match bind_field_idents_oxc(expr, fields, scope, aliases) {
        Some(s) => s,
        None => bind_field_idents_legacy(expr, fields, scope, aliases),
    }
}

fn bind_field_idents_oxc(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> Option<String> {
    use std::collections::HashSet;

    use oxc_allocator::Allocator;
    use oxc_ast::ast::{Expression, IdentifierName, MemberExpression, Statement};
    use oxc_ast_visit::{
        VisitMut,
        walk_mut::{walk_expression},
    };
    use oxc_codegen::{Codegen, CodegenOptions};
    use oxc_parser::Parser;
    use oxc_span::{SPAN, SourceType};
    use oxc_str::Ident;

    use super::ast_util::JsAst;

    let src = format!("({expr})");
    let allocator = Allocator::default();
    let mut program = {
        let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
        if ret.panicked {
            return None;
        }
        ret.program
    };
    let Statement::ExpressionStatement(es) = program.body.first_mut()? else {
        return None;
    };

    let field_set: HashSet<&str> = fields.iter().map(|s| s.as_str()).collect();
    let scope_set: HashSet<&str> = scope.iter().map(|s| s.as_str()).collect();
    let alias_map: std::collections::HashMap<&str, &str> =
        aliases.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    struct Binder<'a, 'b> {
        ast: JsAst<'a>,
        fields: &'b HashSet<&'b str>,
        scope: &'b HashSet<&'b str>,
        aliases: &'b std::collections::HashMap<&'b str, &'b str>,
    }

    impl<'a, 'b> VisitMut<'a> for Binder<'a, 'b> {
        fn visit_expression(&mut self, expr: &mut Expression<'a>) {
            match expr {
                Expression::Identifier(id) => {
                    let name = id.name.as_str();
                    if let Some(to) = self.aliases.get(name) {
                        if let Some(replacement) = parse_alias_expr(&self.ast, to) {
                            *expr = replacement;
                        }
                        return;
                    }
                    if self.fields.contains(name) && !self.scope.contains(name) {
                        *expr = Expression::new_static_member_expression(
                            SPAN,
                            self.ast.ident("this"),
                            IdentifierName::new(
                                SPAN,
                                Ident::from_str_in(name, &self.ast.ast),
                                &self.ast.ast,
                            ),
                            false,
                            &self.ast.ast,
                        );
                        return;
                    }
                }
                Expression::StaticMemberExpression(mem) => {
                    self.visit_expression(&mut mem.object);
                    return;
                }
                Expression::PrivateFieldExpression(mem) => {
                    self.visit_expression(&mut mem.object);
                    return;
                }
                _ => {}
            }
            walk_expression(self, expr);
        }

        fn visit_member_expression(&mut self, expr: &mut MemberExpression<'a>) {
            match expr {
                MemberExpression::StaticMemberExpression(mem) => {
                    self.visit_expression(&mut mem.object);
                }
                MemberExpression::PrivateFieldExpression(mem) => {
                    self.visit_expression(&mut mem.object);
                }
                MemberExpression::ComputedMemberExpression(mem) => {
                    self.visit_expression(&mut mem.object);
                    self.visit_expression(&mut mem.expression);
                }
            }
        }
    }

    fn parse_alias_expr<'a>(b: &JsAst<'a>, alias: &str) -> Option<Expression<'a>> {
        let parts: Vec<&str> = alias.split('.').collect();
        if parts.is_empty() || parts.iter().any(|p| p.is_empty()) {
            return None;
        }
        let mut expr = b.ident(parts[0]);
        for part in &parts[1..] {
            expr = Expression::new_static_member_expression(
                SPAN,
                expr,
                IdentifierName::new(SPAN, Ident::from_str_in(part, &b.ast), &b.ast),
                false,
                &b.ast,
            );
        }
        Some(expr)
    }

    let ast = JsAst::new(&allocator);
    let mut binder = Binder {
        ast,
        fields: &field_set,
        scope: &scope_set,
        aliases: &alias_map,
    };
    binder.visit_expression(&mut es.expression);

    let mut top = &es.expression;
    while let Expression::ParenthesizedExpression(p) = top {
        top = &p.expression;
    }
    let mut codegen = Codegen::new().with_options(CodegenOptions {
        single_quote: true,
        ..CodegenOptions::default()
    });
    codegen.print_expression(top);
    let out = codegen.into_source_text();
    let out = out.trim().trim_end_matches(';').trim().to_string();
    if out.is_empty() { None } else { Some(out) }
}

/// Legacy char scanner (fallback when oxc parse fails).
fn bind_field_idents_legacy(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> String {
    let mut out = String::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' || c == '"' || c == '`' {
            let quote = c;
            out.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                out.push(ch);
                i += 1;
                if ch == '\\' && i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                    continue;
                }
                if ch == quote {
                    break;
                }
            }
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            let preceded_by_this = start >= 5 && {
                let prev: String = chars[start.saturating_sub(5)..start].iter().collect();
                prev.ends_with("this.")
            };
            let preceded_by_dot = start > 0 && chars[start - 1] == '.';
            if let Some((_, to)) = aliases.iter().find(|(from, _)| from == &ident) {
                out.push_str(to);
            } else if !preceded_by_this
                && !preceded_by_dot
                && !scope.iter().any(|s| s == &ident)
                && fields.iter().any(|f| f == &ident)
            {
                out.push_str("this.");
                out.push_str(&ident);
            } else {
                out.push_str(&ident);
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

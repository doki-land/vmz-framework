//! Shared JS emit helpers (events, field binding, ternary split).

use oxc_span::GetSpan;

/// Trusted raw HTML binding (`html={expr}`) - not a DOM attribute.
pub fn is_html_attr(name: &str) -> bool {
    name == "html"
}

/// True when the attr is a **DOM** event listener (`@click` / `on:click` / `onClick`).
/// Does **not** treat `on-submit` kebab as an event — that is a prop name on components.
pub fn is_event_attr(name: &str) -> bool {
    if name.starts_with('@') {
        return name.len() > 1;
    }
    if let Some(rest) = name.strip_prefix("on:") {
        return !rest.is_empty();
    }
    let bytes = name.as_bytes();
    bytes.len() >= 3 && bytes[..2].eq_ignore_ascii_case(b"on") && bytes[2].is_ascii_uppercase()
}

/// Component template `@submit` / `@click.stop` — component event channel (not a prop).
pub fn is_component_event_attr(name: &str) -> bool {
    name.starts_with('@') && name.len() > 1
}

/// `@submit` / `@click.stop` → event name `submit` / `click`.
pub fn component_event_name(name: &str) -> String {
    let raw = name.strip_prefix('@').unwrap_or(name);
    let ev = raw.split('.').next().unwrap_or(raw);
    if ev.contains('-') { kebab_to_camel(ev) } else { ev.to_string() }
}

/// `home-href` / `on-copy` → `homeHref` / `onCopy`. Leaves already-camel names alone.
pub fn kebab_to_camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        if c == '-' {
            upper = true;
            continue;
        }
        if upper {
            for u in c.to_uppercase() {
                out.push(u);
            }
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Template attr on a component → **prop** wire name (script/`public` camelCase).
/// `:on-submit` / `on-submit` → `onSubmit`; `home-href` → `homeHref`.
/// **Never** pass `@event` here — those are [`is_component_event_attr`].
pub fn component_prop_wire_name(attr: &str) -> String {
    debug_assert!(
        !is_component_event_attr(attr),
        "component @event must not use component_prop_wire_name: {attr}"
    );
    if attr.contains('-') {
        return kebab_to_camel(attr);
    }
    attr.to_string()
}

/// Vue expression scope for event handler resolution (class methods / props / template locals).
#[derive(Debug, Clone, Copy, Default)]
pub struct HandlerResolution<'a> {
    /// Public instance method names on the authoring class.
    pub methods: &'a [String],
    /// Public prop names on the authoring class.
    pub props: &'a [String],
    /// Template-local bindings (`v-for` alias, slot scope, etc.).
    pub locals: &'a [String],
}

fn is_simple_ident(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Wrap handler expressions for DOM / component event subscription.
///
/// Resolves bare class method references to `(ev) => this.method(ev)` when Rust scope
/// confirms an instance method. Unknown bare identifiers fail at compile time when
/// `resolution` is provided with method/prop tables.
pub fn wrap_event_handler_body(
    body: &str,
    resolution: HandlerResolution<'_>,
) -> Result<String, String> {
    let body = body.trim();
    if let Some(method) = parse_this_method_call_arrow(body) {
        return Ok(format!("(ev) => this.{method}(ev)"));
    }
    if let Some(rewritten) = rewrite_arrow_bare_method_call(body, resolution) {
        return Ok(rewritten);
    }
    if let Some(rest) = body.strip_prefix("this.") {
        let is_method_ref = is_simple_ident(rest) && !rest.contains('(') && !rest.contains('.');
        if is_method_ref {
            return Ok(format!("(ev) => this.{rest}(ev)"));
        }
    }
    if is_simple_ident(body) && !body.contains('.') && !body.contains('(') {
        if resolution.locals.iter().any(|l| l == body) {
            return Ok(body.to_string());
        }
        if resolution.methods.iter().any(|m| m == body) {
            return Ok(format!("(ev) => this.{body}(ev)"));
        }
        if resolution.props.iter().any(|p| p == body) {
            return Ok(body.to_string());
        }
        if !resolution.methods.is_empty() || !resolution.props.is_empty() {
            return Err(format!(
                "vmz: unresolved event handler `{body}` (not a template local, class method, or prop)"
            ));
        }
    }
    Ok(body.to_string())
}

/// When an interp expression lowers to exactly `this.<field>`, return the field name.
pub fn single_field_binding_target(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> Option<String> {
    let bound = bind_field_idents(expr, fields, scope, aliases);
    let field = bound.strip_prefix("this.")?;
    if field.contains('.') || field.contains('(') || !is_simple_ident(field) {
        return None;
    }
    Some(field.to_string())
}

/// `() => this.foo()` / `(ev) => this.foo(ev)` → `Some("foo")`.
pub fn parse_this_method_call_arrow(body: &str) -> Option<String> {
    let b = body.trim();
    let after_arrow = if let Some(rest) = b.strip_prefix("()") {
        rest
    } else {
        let i = b.find("=>")?;
        if b.as_bytes().first() == Some(&b'(') {
            &b[i..]
        } else {
            return None;
        }
    };
    let after_arrow = after_arrow.trim().strip_prefix("=>")?.trim();
    let rest = after_arrow.strip_prefix("this.")?;
    let (name, after_name) = rest.split_once('(')?;
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return None;
    }
    let after_name = after_name.trim();
    let close = after_name.find(')')?;
    let args = after_name[..close].trim();
    let trail = after_name[close + 1..].trim();
    if !trail.is_empty() && trail != ";" {
        return None;
    }
    if !args.is_empty() && !args.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        return None;
    }
    Some(name.to_string())
}

/// `() => switchLocale('en-us')` / `(e) => onEmail(e)` when `name` is a class method → rewrite with `this.`.
fn rewrite_arrow_bare_method_call(body: &str, resolution: HandlerResolution<'_>) -> Option<String> {
    let b = body.trim();
    let arrow_idx = b.find("=>")?;
    let prefix = b[..=arrow_idx + 1].trim();
    let mut call = b[arrow_idx + 2..].trim();
    if call.ends_with(';') {
        call = call.trim_end_matches(';').trim();
    }
    let paren = call.find('(')?;
    let name = call[..paren].trim();
    if !is_simple_ident(name) || name.contains('.') {
        return None;
    }
    if resolution.locals.iter().any(|l| l == name) {
        return None;
    }
    if !resolution.methods.iter().any(|m| m == name) {
        return None;
    }
    Some(format!("{prefix} this.{call}"))
}

/// DOM event type from `onClick` / `@click` / `@click.stop` / `on:click` / `on-click`.
pub fn event_dom_type(name: &str) -> String {
    let raw = if let Some(rest) = name.strip_prefix('@') {
        rest
    } else if let Some(rest) = name.strip_prefix("on:") {
        rest
    } else if let Some(rest) = name.strip_prefix("on-") {
        rest
    } else if name.len() >= 3 && name.as_bytes()[..2].eq_ignore_ascii_case(b"on") {
        &name[2..]
    } else {
        name
    };
    raw.split('.').next().unwrap_or(raw).to_ascii_lowercase()
}

/// Trim template interp expressions. **Does not** strip leading `this.` —
/// Living `01` requires explicit `this.method` / `this.field` (no silent rewrite).
pub fn sanitize_interp(expr: &str) -> String {
    expr.trim().to_string()
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

/// Top-level `a ? b : c` -> (test, consequent, alternate).
pub fn split_ternary_parts(expr: &str) -> Option<(String, String, String)> {
    let src = super::expr_parse::wrap_template_expr_source(expr);
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() || ret.panicked {
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
        if s < e && e <= src.len() { Some(src[s..e].trim().to_string()) } else { None }
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
    use oxc_ast::ast::{
        Expression, IdentifierName, MemberExpression, SimpleAssignmentTarget, Statement,
    };
    use oxc_ast_visit::{VisitMut, walk_mut};
    use oxc_codegen::{Codegen, CodegenOptions};
    use oxc_parser::Parser;
    use oxc_span::{SPAN, SourceType};
    use oxc_str::Ident;

    use super::ast_util::JsAst;

    let src = super::expr_parse::wrap_template_expr_source(expr);
    let allocator = Allocator::default();
    let mut program = {
        let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
        if ret.panicked || !ret.diagnostics.is_empty() {
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
            walk_mut::walk_expression(self, expr);
        }

        fn visit_simple_assignment_target(&mut self, target: &mut SimpleAssignmentTarget<'a>) {
            // `count++` / `count = 1` use AssignmentTargetIdentifier, not Expression::Identifier.
            if let SimpleAssignmentTarget::AssignmentTargetIdentifier(id) = target {
                let name = id.name.as_str();
                if let Some(to) = self.aliases.get(name) {
                    if let Some(replacement) = parse_alias_assignment_target(&self.ast, to) {
                        *target = replacement;
                    }
                    return;
                }
                if self.fields.contains(name) && !self.scope.contains(name) {
                    *target = SimpleAssignmentTarget::new_static_member_expression(
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
            walk_mut::walk_simple_assignment_target(self, target);
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

    fn parse_alias_assignment_target<'a>(
        b: &JsAst<'a>,
        alias: &str,
    ) -> Option<SimpleAssignmentTarget<'a>> {
        let parts: Vec<&str> = alias.split('.').collect();
        if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
            return None;
        }
        let mut expr = b.ident(parts[0]);
        for part in &parts[1..parts.len() - 1] {
            expr = Expression::new_static_member_expression(
                SPAN,
                expr,
                IdentifierName::new(SPAN, Ident::from_str_in(part, &b.ast), &b.ast),
                false,
                &b.ast,
            );
        }
        let last = parts[parts.len() - 1];
        Some(SimpleAssignmentTarget::new_static_member_expression(
            SPAN,
            expr,
            IdentifierName::new(SPAN, Ident::from_str_in(last, &b.ast), &b.ast),
            false,
            &b.ast,
        ))
    }

    let ast = JsAst::new(&allocator);
    let mut binder = Binder { ast, fields: &field_set, scope: &scope_set, aliases: &alias_map };
    binder.visit_expression(&mut es.expression);

    let mut top = &es.expression;
    while let Expression::ParenthesizedExpression(p) = top {
        top = &p.expression;
    }
    let mut codegen = Codegen::new()
        .with_options(CodegenOptions { single_quote: true, ..CodegenOptions::default() });
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

#[cfg(test)]
mod tests {
    use super::{
        HandlerResolution, bind_field_idents, component_event_name, component_prop_wire_name,
        event_dom_type, is_component_event_attr, is_event_attr, kebab_to_camel,
        wrap_event_handler_body,
    };

    #[test]
    fn kebab_to_camel_basic() {
        assert_eq!(kebab_to_camel("home-href"), "homeHref");
        assert_eq!(kebab_to_camel("copy-label"), "copyLabel");
        assert_eq!(kebab_to_camel("on-copy"), "onCopy");
    }

    #[test]
    fn wrap_event_handler_resolves_bare_class_method() {
        let methods = vec!["bump".into()];
        let res = HandlerResolution { methods: &methods, props: &[], locals: &[] };
        assert_eq!(wrap_event_handler_body("this.bump", res).unwrap(), "(ev) => this.bump(ev)");
        assert_eq!(wrap_event_handler_body("bump", res).unwrap(), "(ev) => this.bump(ev)");
        assert_eq!(
            wrap_event_handler_body("() => this.bump()", res).unwrap(),
            "(ev) => this.bump(ev)"
        );
    }

    #[test]
    fn wrap_event_handler_resolves_bare_method_call_in_arrow() {
        let methods = vec!["switchLocale".into(), "onEmail".into()];
        let res = HandlerResolution { methods: &methods, props: &[], locals: &[] };
        assert_eq!(
            wrap_event_handler_body("() => switchLocale('en-us')", res).unwrap(),
            "() => this.switchLocale('en-us')"
        );
        assert_eq!(
            wrap_event_handler_body("(e) => onEmail(e)", res).unwrap(),
            "(e) => this.onEmail(e)"
        );
    }

    #[test]
    fn wrap_event_handler_arrow_local_shadows_method() {
        let methods = vec!["switchLocale".into()];
        let locals = vec!["switchLocale".into()];
        let res = HandlerResolution { methods: &methods, props: &[], locals: &locals };
        assert_eq!(
            wrap_event_handler_body("() => switchLocale('en-us')", res).unwrap(),
            "() => switchLocale('en-us')"
        );
    }

    #[test]
    fn wrap_event_handler_local_shadows_method() {
        let methods = vec!["bump".into()];
        let locals = vec!["bump".into()];
        let res = HandlerResolution { methods: &methods, props: &[], locals: &locals };
        assert_eq!(wrap_event_handler_body("bump", res).unwrap(), "bump");
    }

    #[test]
    fn wrap_event_handler_unknown_bare_fails() {
        let methods = vec!["bump".into()];
        let res = HandlerResolution { methods: &methods, props: &[], locals: &[] };
        assert!(wrap_event_handler_body("missing", res).is_err());
    }

    #[test]
    fn component_prop_wire_name_props_only_not_at_events() {
        assert_eq!(component_prop_wire_name("on-submit"), "onSubmit");
        assert_eq!(component_prop_wire_name("on-copy"), "onCopy");
        assert_eq!(component_prop_wire_name("home-href"), "homeHref");
        assert_eq!(component_prop_wire_name("copy-label"), "copyLabel");
        assert_eq!(component_prop_wire_name("type"), "type");
        assert_eq!(component_event_name("@submit"), "submit");
        assert_eq!(component_event_name("@click.stop"), "click");
        assert!(is_component_event_attr("@submit"));
        assert!(!is_component_event_attr("on-submit"));
        assert!(!is_event_attr("on-submit"));
        assert!(is_event_attr("@click"));
        assert!(is_event_attr("onClick"));
    }

    #[test]
    fn event_dom_type_accepts_at_and_on_camel() {
        assert_eq!(event_dom_type("@click"), "click");
        assert_eq!(event_dom_type("onClick"), "click");
        assert_eq!(event_dom_type("on:click"), "click");
    }

    #[test]
    fn binds_count_in_arrow_update() {
        let fields = vec!["count".into()];
        let out = bind_field_idents("() => count++", &fields, &[], &[]);
        assert!(out.contains("this.count"), "got {out}");
        let out2 = bind_field_idents("count++", &fields, &[], &[]);
        assert!(out2.contains("this.count"), "got {out2}");
        let out3 = bind_field_idents("() => { count = 1 }", &fields, &[], &[]);
        assert!(out3.contains("this.count"), "got {out3}");
    }

    #[test]
    fn binds_row_kernel_class_shape() {
        let fields = vec!["rows".into(), "selected".into()];
        let scope = vec!["row".into(), "index".into()];
        let aliases =
            vec![("row".into(), "box1.item".into()), ("index".into(), "box1.index".into())];
        let out =
            bind_field_idents("selected === row.id ? \"danger\" : \"\"", &fields, &scope, &aliases);
        assert!(
            out.starts_with("this.selected") || out.contains("this.selected ==="),
            "unexpected shape: {out}"
        );
        assert!(out.contains("box1.item.id"), "got {out}");
        let act = bind_field_idents("() => this.select(row.id)", &fields, &scope, &aliases);
        eprintln!("ACT={act}");
        eprintln!("CLASS={out}");
    }
}

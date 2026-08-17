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

/// Rewrite bare field idents to `this.field`.
/// Skips string / template literal contents so `'is-open'` is not rewritten to `'is-this.open'`.
pub fn bind_field_idents(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> String {
    if fields.is_empty() && scope.is_empty() && aliases.is_empty() {
        return expr.trim().to_string();
    }
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

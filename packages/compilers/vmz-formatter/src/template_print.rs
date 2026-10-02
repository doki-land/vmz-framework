//! Print Semantic template AST as Vue author syntax (OXC-canonical expressions).

use vmz_compiler::{
    Directive, DirectiveArg, SemanticIr, SemanticNode, SemanticProp, TemplateBlock,
    parse_template_semantic_primary,
};
use vmz_generator::print_template_expr;

use crate::editorconfig::EditorSettings;

/// Format a `<template>` body via Oak layers Semantic → Vue print.
///
/// Expressions are canonicalized through oxc print (no raw string replay).
pub fn format_template_body(body: &str, settings: &EditorSettings) -> Result<String, String> {
    let block = TemplateBlock { content: body.to_string(), content_start: 0 };
    let semantic = parse_template_semantic_primary(&block).map_err(|e| e.message)?;
    print_semantic(&semantic, settings)
}

/// Canonical expression text for Vue attr / interpolation slots.
fn oxc_expr(expr: &str) -> Result<String, String> {
    print_template_expr(expr)
}

/// Delimit a printed JS expression for a Vue/HTML attribute value.
///
/// oxc codegen prefers double-quoted string literals. Inside `attr="…"` that breaks
/// when the expression itself contains `"`. Prefer single-quoted attribute delimiters
/// in that case (Vue author surface).
fn delimit_vue_attr_value(printed: &str) -> String {
    if printed.is_empty() {
        return "\"\"".to_string();
    }
    if !printed.contains('"') {
        return format!("\"{}\"", printed);
    }
    if !printed.contains('\'') {
        return format!("'{}'", printed);
    }
    format!("\"{}\"", escape_js_double_quotes(printed))
}

fn escape_js_double_quotes(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => {
                out.push('\\');
                out.push('\\');
            }
            '"' => {
                out.push('\\');
                out.push('"');
            }
            other => out.push(other),
        }
    }
    out
}

fn vue_attr_assignment(expr: &str) -> Result<String, String> {
    Ok(format!("={}", delimit_vue_attr_value(&oxc_expr(expr)?)))
}

fn print_semantic(sem: &SemanticIr, settings: &EditorSettings) -> Result<String, String> {
    let nl = settings.newline();
    let mut lines = Vec::new();
    for root in &sem.roots {
        print_node(root, 0, settings, &mut lines)?;
    }
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    Ok(lines.join(nl))
}

fn print_node(
    node: &SemanticNode,
    depth: usize,
    settings: &EditorSettings,
    lines: &mut Vec<String>,
) -> Result<(), String> {
    match node {
        SemanticNode::Text { value, .. } => {
            let t = value.trim();
            if !t.is_empty() {
                let pad = settings.indent_unit().repeat(depth);
                lines.push(format!("{pad}{t}"));
            }
        }
        SemanticNode::Interpolation { expr, .. } => {
            let pad = settings.indent_unit().repeat(depth);
            let e = oxc_expr(expr)?;
            lines.push(format!("{pad}{{{{ {e} }}}}"));
        }
        SemanticNode::Element { tag, props, children, .. } => {
            print_element(tag, props, children, depth, settings, lines, &[])?;
        }
        SemanticNode::IfChain { branches, .. } => {
            for (i, b) in branches.iter().enumerate() {
                let cf = match &b.test {
                    Some(test) if i == 0 => vec![format!("v-if{}", vue_attr_assignment(test)?)],
                    Some(test) => vec![format!("v-else-if{}", vue_attr_assignment(test)?)],
                    None => vec!["v-else".to_string()],
                };
                print_node_with_control(b.body.as_ref(), depth, settings, lines, &cf)?;
            }
        }
        SemanticNode::ForNode {
            source, value_alias, key_alias, index_alias, key, body, ..
        } => {
            let alias = match (key_alias, index_alias) {
                (Some(k), Some(i)) => format!("({value_alias}, {k}, {i})"),
                (Some(k), None) => format!("({value_alias}, {k})"),
                (None, Some(i)) => format!("({value_alias}, {i})"),
                (None, None) => value_alias.clone(),
            };
            let mut cf = vec![format!(
                "v-for={}",
                delimit_vue_attr_value(&format!("{alias} in {}", oxc_expr(source)?))
            )];
            if let Some(k) = key {
                cf.push(format!(":key{}", vue_attr_assignment(k)?));
            }
            print_node_with_control(body.as_ref(), depth, settings, lines, &cf)?;
        }
        SemanticNode::SlotOutlet { name, props, children, .. } => {
            let pad = settings.indent_unit().repeat(depth);
            let mut open = format!("{pad}<slot");
            if let Some(n) = name {
                open.push_str(&format!(" name=\"{n}\""));
            }
            open.push_str(&format_props(props)?);
            if children.is_empty() {
                open.push_str(" />");
                lines.push(open);
            } else {
                open.push('>');
                lines.push(open);
                for c in children {
                    print_node(c, depth + 1, settings, lines)?;
                }
                lines.push(format!("{pad}</slot>"));
            }
        }
        SemanticNode::SlotTemplate { name, slot_props, body, .. } => {
            let pad = settings.indent_unit().repeat(depth);
            let name_s = match name {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{}]", oxc_expr(e)?),
            };
            let mut open = format!("{pad}<template #{name_s}");
            if let Some(p) = slot_props {
                open.push_str(&vue_attr_assignment(p)?);
            }
            open.push('>');
            lines.push(open);
            print_node(body.as_ref(), depth + 1, settings, lines)?;
            lines.push(format!("{pad}</template>"));
        }
    }
    Ok(())
}

fn print_node_with_control(
    node: &SemanticNode,
    depth: usize,
    settings: &EditorSettings,
    lines: &mut Vec<String>,
    control: &[String],
) -> Result<(), String> {
    match node {
        SemanticNode::Element { tag, props, children, .. } => {
            print_element(tag, props, children, depth, settings, lines, control)
        }
        other => {
            if !control.is_empty() {
                let pad = settings.indent_unit().repeat(depth);
                lines.push(format!("{pad}<!-- {} -->", control.join(" ")));
            }
            print_node(other, depth, settings, lines)
        }
    }
}

fn print_element(
    tag: &str,
    props: &[SemanticProp],
    children: &[SemanticNode],
    depth: usize,
    settings: &EditorSettings,
    lines: &mut Vec<String>,
    control: &[String],
) -> Result<(), String> {
    let pad = settings.indent_unit().repeat(depth);
    if tag == "template" && props.is_empty() && control.is_empty() {
        for c in children {
            print_node(c, depth, settings, lines)?;
        }
        return Ok(());
    }
    let mut open = format!("{pad}<{tag}");
    for c in control {
        open.push(' ');
        open.push_str(c);
    }
    open.push_str(&format_props(props)?);
    if children.is_empty() {
        open.push_str(" />");
        lines.push(open);
        return Ok(());
    }
    open.push('>');
    lines.push(open);
    for c in children {
        print_node(c, depth + 1, settings, lines)?;
    }
    lines.push(format!("{pad}</{tag}>"));
    Ok(())
}

fn format_props(props: &[SemanticProp]) -> Result<String, String> {
    let mut s = String::new();
    for p in props {
        match p {
            SemanticProp::Static { name, value, .. } => {
                if value.is_empty() {
                    s.push_str(&format!(" {name}"));
                } else {
                    s.push_str(&format!(" {name}=\"{value}\""));
                }
            }
            SemanticProp::Bind { arg, expr, modifiers, .. } => {
                let arg_s = format_arg(arg)?;
                let mods = format_modifiers(modifiers);
                s.push_str(&format!(" :{arg_s}{mods}{}", vue_attr_assignment(expr)?));
            }
            SemanticProp::BindObject { expr, .. } => {
                s.push_str(&format!(" v-bind{}", vue_attr_assignment(expr)?));
            }
            SemanticProp::On { arg, handler, modifiers, .. } => {
                let arg_s = format_arg(arg)?;
                let mods = format_modifiers(modifiers);
                s.push_str(&format!(" @{arg_s}{mods}{}", vue_attr_assignment(handler)?));
            }
            SemanticProp::OnObject { expr, .. } => {
                s.push_str(&format!(" v-on{}", vue_attr_assignment(expr)?));
            }
            SemanticProp::Model { arg, expr, modifiers, .. } => {
                let mods = format_modifiers(modifiers);
                let assignment = vue_attr_assignment(expr)?;
                match arg {
                    None => s.push_str(&format!(" v-model{mods}{assignment}")),
                    Some(a) => s.push_str(&format!(" v-model:{a}{mods}{assignment}")),
                }
            }
            SemanticProp::ClassPlan { static_classes, binds, .. } => {
                if !static_classes.is_empty() {
                    s.push_str(&format!(" class=\"{}\"", static_classes.join(" ")));
                }
                for b in binds {
                    s.push_str(&format!(" :class{}", vue_attr_assignment(b)?));
                }
            }
            SemanticProp::StylePlan { static_style, binds, .. } => {
                if let Some(st) = static_style {
                    s.push_str(&format!(" style=\"{st}\""));
                }
                for b in binds {
                    s.push_str(&format!(" :style{}", vue_attr_assignment(b)?));
                }
            }
            SemanticProp::Directive { dir, .. } => match dir {
                Directive::Show { expr } => {
                    s.push_str(&format!(" v-show{}", vue_attr_assignment(expr)?))
                }
                Directive::Html { expr } => {
                    s.push_str(&format!(" v-html{}", vue_attr_assignment(expr)?))
                }
                Directive::Custom { name, arg, expr, modifiers } => {
                    let mods = format_modifiers(modifiers);
                    let arg_s = match arg {
                        None => String::new(),
                        Some(a) => format!(":{}", format_arg(a)?),
                    };
                    match expr {
                        Some(e) => s.push_str(&format!(
                            " v-{name}{arg_s}{mods}{}",
                            vue_attr_assignment(e)?
                        )),
                        None => s.push_str(&format!(" v-{name}{arg_s}{mods}")),
                    }
                }
                _ => {}
            },
        }
    }
    Ok(s)
}

fn format_arg(arg: &DirectiveArg) -> Result<String, String> {
    match arg {
        DirectiveArg::Static(n) => Ok(n.clone()),
        DirectiveArg::Dynamic(e) => Ok(format!("[{}]", oxc_expr(e)?)),
    }
}

fn format_modifiers(mods: &[String]) -> String {
    mods.iter().map(|m| format!(".{m}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editorconfig::EditorSettings;

    fn settings() -> EditorSettings {
        EditorSettings::default()
    }

    #[test]
    fn format_roundtrips_vue_surface() {
        let src = r#"
<div>
  <input v-model="q" />
  <Card>
    <template #header="p">
      <h1>{{ p.title }}</h1>
    </template>
    <slot name="body" />
  </Card>
</div>
"#;
        let once = format_template_body(src, &settings()).unwrap();
        let twice = format_template_body(&once, &settings()).unwrap();
        assert_eq!(once, twice, "once={once:?}");
        assert!(
            !once.contains('{') || once.contains("{{"),
            "must not emit unquoted brace attrs: {once}"
        );
        assert!(once.contains("v-model="), "{once}");
        assert!(once.contains("#header"), "{once}");
    }

    #[test]
    fn rejects_unquoted_brace_attr() {
        let err = format_template_body(r#"<Button onClick={inc} />"#, &settings()).unwrap_err();
        assert!(
            err.contains("unquoted")
                || err.contains('{')
                || err.to_ascii_lowercase().contains("parse"),
            "expected parse rejection, got {err}"
        );
    }

    #[test]
    fn prints_if_for_as_vue_directives() {
        let src = r#"
<p v-if="a">A</p>
<p v-else>B</p>
<li v-for="(item, i) in items" :key="item.id">{{ item }}</li>
"#;
        let out = format_template_body(src, &settings()).unwrap();
        assert!(out.contains("v-if=\"a\""), "{out}");
        assert!(out.contains("v-else"), "{out}");
        assert!(out.contains("v-for="), "{out}");
    }

    #[test]
    fn class_bind_string_concat_does_not_corrupt_attr_quotes() {
        let src = r#"<div :class="'vmz-ui-select' + (open ? ' is-opened' : '')" />"#;
        let out = format_template_body(src, &settings()).unwrap();
        assert!(!out.contains(":class=\"\""), "corrupted nested quotes: {out}");
        let twice = format_template_body(&out, &settings()).unwrap();
        assert_eq!(out, twice, "idempotent: {out}");
    }

    #[test]
    fn class_bind_double_quoted_literals_roundtrip() {
        let src = r#"<div :class='"vmz-ui-select" + (open ? " is-opened" : "") + (isMultiple ? " is-multiple" : "")' />"#;
        let out = format_template_body(src, &settings()).unwrap();
        assert!(!out.contains(":class=\"\""), "corrupted nested quotes: {out}");
        assert!(
            out.contains("vmz-ui-select") && out.contains("is-opened"),
            "expression must survive print: {out}"
        );
        let twice = format_template_body(&out, &settings()).unwrap();
        assert_eq!(out, twice, "idempotent: {out}");
    }

    #[test]
    fn oxc_expr_print_is_idempotent_inside_template() {
        let src = r#"<p>{{ a+b }}</p>"#;
        let once = format_template_body(src, &settings()).unwrap();
        let twice = format_template_body(&once, &settings()).unwrap();
        assert_eq!(once, twice);
        assert!(once.contains("{{"), "{once}");
    }

    #[test]
    fn aria_invalid_ternary_roundtrips_without_quote_corruption() {
        let src = r#"<input :aria-invalid='error ? "true" : "false"' />"#;
        let out = format_template_body(src, &settings()).unwrap();
        assert!(
            !out.contains("\\\"true\\\"") && !out.contains(":aria-invalid=\"\""),
            "corrupted nested quotes: {out}"
        );
        let twice = format_template_body(&out, &settings()).unwrap();
        assert_eq!(out, twice, "idempotent: {out}");
    }
}

//! Print Semantic template AST as Vue author syntax (no JSX).

use vmz_compiler::{
    Directive, DirectiveArg, SemanticIr, SemanticNode, SemanticProp, lower_concrete_to_semantic,
    parse_template_concrete,
};

use crate::editorconfig::EditorSettings;

/// Format a `<template>` body via Concrete → Semantic → Vue print.
///
/// Rejects JSX / illegal templates with a structured error string (no JSX emit).
pub fn format_template_body(body: &str, settings: &EditorSettings) -> Result<String, String> {
    let concrete = parse_template_concrete(body).map_err(|e| e.message)?;
    let semantic = lower_concrete_to_semantic(&concrete).map_err(|e| e.message)?;
    Ok(print_semantic(&semantic, settings))
}

fn print_semantic(sem: &SemanticIr, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let mut lines = Vec::new();
    for root in &sem.roots {
        print_node(root, 0, settings, &mut lines);
    }
    // Drop trailing empty lines; assemble adds envelope newline.
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines.join(nl)
}

fn print_node(
    node: &SemanticNode,
    depth: usize,
    settings: &EditorSettings,
    lines: &mut Vec<String>,
) {
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
            lines.push(format!("{pad}{{{{ {expr} }}}}"));
        }
        SemanticNode::Element { tag, props, children, .. } => {
            print_element(tag, props, children, depth, settings, lines, &[]);
        }
        SemanticNode::IfChain { branches, .. } => {
            for (i, b) in branches.iter().enumerate() {
                let cf = match &b.test {
                    Some(test) if i == 0 => vec![format!("v-if=\"{test}\"")],
                    Some(test) => vec![format!("v-else-if=\"{test}\"")],
                    None => vec!["v-else".to_string()],
                };
                print_node_with_control(b.body.as_ref(), depth, settings, lines, &cf);
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
            let mut cf = vec![format!("v-for=\"{alias} in {source}\"")];
            if let Some(k) = key {
                cf.push(format!(":key=\"{k}\""));
            }
            print_node_with_control(body.as_ref(), depth, settings, lines, &cf);
        }
        SemanticNode::SlotOutlet { name, props, children, .. } => {
            let pad = settings.indent_unit().repeat(depth);
            let mut open = format!("{pad}<slot");
            if let Some(n) = name {
                open.push_str(&format!(" name=\"{n}\""));
            }
            open.push_str(&format_props(props));
            if children.is_empty() {
                open.push_str(" />");
                lines.push(open);
            } else {
                open.push('>');
                lines.push(open);
                for c in children {
                    print_node(c, depth + 1, settings, lines);
                }
                lines.push(format!("{pad}</slot>"));
            }
        }
        SemanticNode::SlotTemplate { name, slot_props, body, .. } => {
            let pad = settings.indent_unit().repeat(depth);
            let name_s = match name {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            let mut open = format!("{pad}<template #{name_s}");
            if let Some(p) = slot_props {
                open.push_str(&format!("=\"{p}\""));
            }
            open.push('>');
            lines.push(open);
            print_node(body.as_ref(), depth + 1, settings, lines);
            lines.push(format!("{pad}</template>"));
        }
    }
}

fn print_node_with_control(
    node: &SemanticNode,
    depth: usize,
    settings: &EditorSettings,
    lines: &mut Vec<String>,
    control: &[String],
) {
    match node {
        SemanticNode::Element { tag, props, children, .. } => {
            print_element(tag, props, children, depth, settings, lines, control);
        }
        other => {
            // Rare: control on non-element — print control as a wrapper comment then body.
            if !control.is_empty() {
                let pad = settings.indent_unit().repeat(depth);
                lines.push(format!("{pad}<!-- {} -->", control.join(" ")));
            }
            print_node(other, depth, settings, lines);
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
) {
    let pad = settings.indent_unit().repeat(depth);
    // Bare `<template>` wrapper with no props/control: unwrap children.
    if tag == "template" && props.is_empty() && control.is_empty() {
        for c in children {
            print_node(c, depth, settings, lines);
        }
        return;
    }
    let mut open = format!("{pad}<{tag}");
    for c in control {
        open.push(' ');
        open.push_str(c);
    }
    open.push_str(&format_props(props));
    if children.is_empty() {
        open.push_str(" />");
        lines.push(open);
        return;
    }
    open.push('>');
    lines.push(open);
    for c in children {
        print_node(c, depth + 1, settings, lines);
    }
    lines.push(format!("{pad}</{tag}>"));
}

fn format_props(props: &[SemanticProp]) -> String {
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
                let arg_s = format_arg(arg);
                let mods = format_modifiers(modifiers);
                s.push_str(&format!(" :{arg_s}{mods}=\"{expr}\""));
            }
            SemanticProp::BindObject { expr, .. } => {
                s.push_str(&format!(" v-bind=\"{expr}\""));
            }
            SemanticProp::On { arg, handler, modifiers, .. } => {
                let arg_s = format_arg(arg);
                let mods = format_modifiers(modifiers);
                s.push_str(&format!(" @{arg_s}{mods}=\"{handler}\""));
            }
            SemanticProp::OnObject { expr, .. } => {
                s.push_str(&format!(" v-on=\"{expr}\""));
            }
            SemanticProp::Model { arg, expr, modifiers, .. } => {
                let mods = format_modifiers(modifiers);
                match arg {
                    None => s.push_str(&format!(" v-model{mods}=\"{expr}\"")),
                    Some(a) => s.push_str(&format!(" v-model:{a}{mods}=\"{expr}\"")),
                }
            }
            SemanticProp::ClassPlan { static_classes, binds, .. } => {
                if !static_classes.is_empty() {
                    s.push_str(&format!(" class=\"{}\"", static_classes.join(" ")));
                }
                for b in binds {
                    s.push_str(&format!(" :class=\"{b}\""));
                }
            }
            SemanticProp::StylePlan { static_style, binds, .. } => {
                if let Some(st) = static_style {
                    s.push_str(&format!(" style=\"{st}\""));
                }
                for b in binds {
                    s.push_str(&format!(" :style=\"{b}\""));
                }
            }
            SemanticProp::Directive { dir, .. } => match dir {
                Directive::Show { expr } => s.push_str(&format!(" v-show=\"{expr}\"")),
                Directive::Html { expr } => s.push_str(&format!(" v-html=\"{expr}\"")),
                Directive::Custom { name, arg, expr, modifiers } => {
                    let mods = format_modifiers(modifiers);
                    let arg_s = match arg {
                        None => String::new(),
                        Some(a) => format!(":{}", format_arg(a)),
                    };
                    match expr {
                        Some(e) => s.push_str(&format!(" v-{name}{arg_s}{mods}=\"{e}\"")),
                        None => s.push_str(&format!(" v-{name}{arg_s}{mods}")),
                    }
                }
                _ => {}
            },
        }
    }
    s
}

fn format_arg(arg: &DirectiveArg) -> String {
    match arg {
        DirectiveArg::Static(n) => n.clone(),
        DirectiveArg::Dynamic(e) => format!("[{e}]"),
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
        EditorSettings {
            use_tabs: false,
            indent_width: 2,
            line_width: None,
            end_of_line: crate::editorconfig::EndOfLine::Lf,
            insert_final_newline: true,
            trim_trailing_whitespace: true,
        }
    }

    #[test]
    fn template_print_is_idempotent_on_slot_and_model() {
        let src = r#"
<div class="box" :class="extra">
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
            "must not emit JSX attr braces: {once}"
        );
        assert!(once.contains("v-model="), "{once}");
        assert!(once.contains("#header"), "{once}");
    }

    #[test]
    fn rejects_jsx_attr_without_emitting_jsx() {
        let err = format_template_body(r#"<Button onClick={inc} />"#, &settings()).unwrap_err();
        assert!(
            err.to_ascii_lowercase().contains("jsx") || err.contains('{'),
            "expected JSX rejection, got {err}"
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
        assert!(out.contains(":key="), "{out}");
        let again = format_template_body(&out, &settings()).unwrap();
        assert_eq!(out, again);
    }
}

//! Adapter: Concrete AST → legacy [`TemplateIr`] (emit contract unchanged).

use super::template_common::{TemplateParseError, is_assignable_model_target, native_model_bind};
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg};
use super::template_ir::{AttrValue, TemplateAttr, TemplateIr, TemplateNode, VerbatimChild};

/// Lower Concrete AST into the pipeline IR consumed by structural/reactive/emit.
pub fn lower_concrete_to_ir(concrete: &ConcreteIr) -> Result<TemplateIr, TemplateParseError> {
    let mut roots = Vec::new();
    for node in &concrete.roots {
        if let Some(n) = lower_node(node)? {
            roots.push(n);
        }
    }
    Ok(TemplateIr { roots })
}

fn lower_node(node: &ConcreteNode) -> Result<Option<TemplateNode>, TemplateParseError> {
    match node {
        ConcreteNode::Comment { .. } => Ok(None),
        ConcreteNode::Text { value, .. } => {
            if value.trim().is_empty() {
                Ok(None)
            } else {
                Ok(Some(TemplateNode::Text(normalize_render_text(value))))
            }
        }
        ConcreteNode::Interpolation { expr, .. } => Ok(Some(TemplateNode::Interp(expr.clone()))),
        ConcreteNode::Element { tag, attrs, children, .. } => {
            if attrs.iter().any(is_pre_directive) {
                return Ok(Some(lower_verbatim_element(tag, attrs, children)));
            }
            let mut ir_attrs = Vec::new();
            for attr in attrs {
                ir_attrs.extend(lower_attr(attr, tag, attrs)?);
            }
            let mut ir_children = Vec::new();
            for child in children {
                if let Some(c) = lower_node(child)? {
                    ir_children.push(c);
                }
            }
            Ok(Some(TemplateNode::Element {
                tag: tag.clone(),
                attrs: ir_attrs,
                children: ir_children,
            }))
        }
    }
}

// ——————————————————————————————————————————————————————————————————————————
// `v-pre` verbatim lowering
// ——————————————————————————————————————————————————————————————————————————

fn is_pre_directive(attr: &ConcreteAttr) -> bool {
    matches!(attr, ConcreteAttr::Directive { dir: Directive::Pre, .. })
}

/// Lower a `v-pre` element and its whole subtree without any semantic transform.
///
/// Text keeps the author's bytes (no [`normalize_render_text`], no whitespace-only
/// drop) and `{{ expr }}` becomes literal text. Nested elements are `Verbatim`
/// too, so a descendant never falls back to attribute lowering.
fn lower_verbatim_element(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[ConcreteNode],
) -> TemplateNode {
    TemplateNode::Verbatim {
        tag: tag.to_string(),
        // The `v-pre` that opens the region is consumed by the region itself;
        // emitting it would add an attribute Vue never renders. Every other
        // attribute keeps its authored spelling.
        attrs: attrs.iter().filter(|a| !is_pre_directive(a)).map(verbatim_attr).collect(),
        children: children.iter().filter_map(verbatim_child).collect(),
    }
}

/// Comments stay dropped (the IR has no comment node anywhere); everything else
/// keeps its authored text.
fn verbatim_child(node: &ConcreteNode) -> Option<VerbatimChild> {
    match node {
        ConcreteNode::Comment { .. } => None,
        ConcreteNode::Text { value, .. } => Some(VerbatimChild::Text(value.clone())),
        // Concrete keeps the parsed body; the delimiters are reconstruction, not
        // re-serialized markup — the value stays plain text for the render path.
        ConcreteNode::Interpolation { expr, .. } => {
            Some(VerbatimChild::Text(format!("{{{{ {expr} }}}}")))
        }
        ConcreteNode::Element { tag, attrs, children, .. } => Some(VerbatimChild::Element {
            tag: tag.clone(),
            attrs: attrs.iter().map(verbatim_attr).collect(),
            children: children.iter().filter_map(verbatim_child).collect(),
        }),
    }
}

/// Rebuild the authored attribute spelling. Concrete folds `:x` / `v-bind:x`
/// into one variant, so the short spelling is what can be reconstructed without
/// inventing source text; the directive name itself is never rewritten.
fn verbatim_attr(attr: &ConcreteAttr) -> TemplateAttr {
    match attr {
        ConcreteAttr::Static { name, value, .. } => TemplateAttr {
            name: name.clone(),
            value: AttrValue::Static(value.clone()),
            ..Default::default()
        },
        ConcreteAttr::Directive { dir, .. } => {
            let (name, value) = verbatim_directive_spelling(dir);
            TemplateAttr { name, value: AttrValue::Static(value), ..Default::default() }
        }
    }
}

fn verbatim_directive_spelling(dir: &Directive) -> (String, String) {
    let arg = |a: &DirectiveArg| match a {
        DirectiveArg::Static(s) => s.clone(),
        DirectiveArg::Dynamic(e) => format!("[{e}]"),
    };
    let with_modifiers = |base: String, modifiers: &[String]| {
        let mut out = base;
        for m in modifiers {
            out.push('.');
            out.push_str(m);
        }
        out
    };
    match dir {
        Directive::Pre => ("v-pre".into(), String::new()),
        Directive::Once => ("v-once".into(), String::new()),
        Directive::Memo { deps } => ("v-memo".into(), deps.clone()),
        Directive::If { test } => ("v-if".into(), test.clone()),
        Directive::ElseIf { test } => ("v-else-if".into(), test.clone()),
        Directive::Else => ("v-else".into(), String::new()),
        Directive::For { source, value_alias, key_alias, index_alias } => {
            let mut aliases = vec![value_alias.clone()];
            aliases.extend(key_alias.clone());
            aliases.extend(index_alias.clone());
            if aliases.len() == 1 {
                ("v-for".into(), format!("{value_alias} in {source}"))
            } else {
                ("v-for".into(), format!("({}) in {source}", aliases.join(", ")))
            }
        }
        Directive::Bind { arg: a, expr, modifiers } => {
            (with_modifiers(format!(":{}", arg(a)), modifiers), expr.clone())
        }
        Directive::BindObject { expr } => ("v-bind".into(), expr.clone()),
        Directive::On { arg: a, handler, modifiers } => {
            (with_modifiers(format!("@{}", arg(a)), modifiers), handler.clone())
        }
        Directive::OnObject { expr } => ("v-on".into(), expr.clone()),
        Directive::Slot { name, props } => {
            (format!("#{}", arg(name)), props.clone().unwrap_or_default())
        }
        Directive::Html { expr } => ("v-html".into(), expr.clone()),
        Directive::Text { expr } => ("v-text".into(), expr.clone()),
        Directive::Show { expr } => ("v-show".into(), expr.clone()),
        Directive::Model { arg: a, expr, modifiers } => {
            let base = match a {
                Some(a) => format!("v-model:{a}"),
                None => "v-model".into(),
            };
            (with_modifiers(base, modifiers), expr.clone())
        }
        Directive::Custom { name, arg: a, expr, modifiers } => {
            let base = match a {
                Some(a) => format!("v-{name}:{}", arg(a)),
                None => format!("v-{name}"),
            };
            (with_modifiers(base, modifiers), expr.clone().unwrap_or_default())
        }
    }
}

// Concrete AST retains author text for tooling. The execution IR condenses
// indentation newlines so an adjacent interpolation remains one text phrase.
fn normalize_render_text(value: &str) -> String {
    if !value.contains(['\n', '\r']) {
        return value.to_string();
    }
    let mut normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.chars().last().is_some_and(char::is_whitespace) {
        normalized.push(' ');
    }
    normalized
}

fn lower_attr(
    attr: &ConcreteAttr,
    tag: &str,
    attrs: &[ConcreteAttr],
) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    match attr {
        ConcreteAttr::Static { name, value, .. } => Ok(vec![TemplateAttr {
            name: name.clone(),
            value: AttrValue::Static(value.clone()),
            ..Default::default()
        }]),
        ConcreteAttr::Directive { dir, span } => {
            lower_directive(dir, span.start as usize, tag, attrs)
        }
    }
}

fn static_attr_value<'a>(attrs: &'a [ConcreteAttr], name: &str) -> Option<&'a str> {
    attrs.iter().find_map(|a| match a {
        ConcreteAttr::Static { name: n, value, .. } if n == name => Some(value.as_str()),
        _ => None,
    })
}

fn bound_attr_expr<'a>(attrs: &'a [ConcreteAttr], name: &str) -> Option<&'a str> {
    attrs.iter().find_map(|a| match a {
        ConcreteAttr::Directive {
            dir: Directive::Bind { arg: DirectiveArg::Static(n), expr, .. },
            ..
        } if n == name => Some(expr.as_str()),
        _ => None,
    })
}

fn lower_directive(
    dir: &Directive,
    offset: usize,
    tag: &str,
    attrs: &[ConcreteAttr],
) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    match dir {
        Directive::If { test } => Ok(vec![TemplateAttr {
            name: "if".into(),
            value: AttrValue::Interp(test.clone()),
            ..Default::default()
        }]),
        Directive::ElseIf { test } => Ok(vec![TemplateAttr {
            name: "else-if".into(),
            value: AttrValue::Interp(test.clone()),
            ..Default::default()
        }]),
        Directive::Else => Ok(vec![TemplateAttr {
            name: "else".into(),
            value: AttrValue::Static(String::new()),
            ..Default::default()
        }]),
        Directive::For { source, value_alias, key_alias, index_alias } => {
            // Preserve full alias list: value_alias (always) + optional key_alias and index_alias.
            let mut attrs = vec![
                TemplateAttr {
                    name: "each".into(),
                    value: AttrValue::Interp(source.clone()),
                    ..Default::default()
                },
                TemplateAttr {
                    name: "as".into(),
                    value: AttrValue::Static(value_alias.clone()),
                    ..Default::default()
                },
            ];
            if let Some(k) = key_alias {
                attrs.push(TemplateAttr {
                    name: "key-alias".into(),
                    value: AttrValue::Static(k.clone()),
                    ..Default::default()
                });
            }
            if let Some(i) = index_alias {
                attrs.push(TemplateAttr {
                    name: "index-alias".into(),
                    value: AttrValue::Static(i.clone()),
                    ..Default::default()
                });
            }
            Ok(attrs)
        }
        Directive::Bind { arg, expr, modifiers } => {
            let ir_name = match arg {
                DirectiveArg::Static(s) if s == "key" => "key".to_string(),
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            Ok(vec![TemplateAttr {
                name: ir_name,
                value: AttrValue::Interp(expr.clone()),
                modifiers: modifiers.clone(),
            }])
        }
        Directive::BindObject { expr } => Ok(vec![TemplateAttr {
            name: "v-bind".into(),
            value: AttrValue::Interp(expr.clone()),
            ..Default::default()
        }]),
        Directive::On { arg, handler, modifiers } => {
            // Modifiers retained on TemplateAttr so downstream emit can act on
            // `@click.stop.prevent` without re-parsing the name string.
            let event = match arg {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            Ok(vec![TemplateAttr {
                name: format!("@{event}"),
                value: AttrValue::Interp(handler.clone()),
                modifiers: modifiers.clone(),
            }])
        }
        Directive::OnObject { expr } => Ok(vec![TemplateAttr {
            name: "v-on".into(),
            value: AttrValue::Interp(expr.clone()),
            ..Default::default()
        }]),
        Directive::Slot { name, props } => {
            // Allow both static and dynamic slot names. Dynamic form keeps `[[expr]]`
            // syntax so structural_build can distinguish it from a static literal name.
            let slot_name = match name {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            Ok(vec![TemplateAttr {
                name: format!("#{slot_name}"),
                value: AttrValue::Static(props.clone().unwrap_or_default()),
                ..Default::default()
            }])
        }
        Directive::Html { expr } => Ok(vec![TemplateAttr {
            name: "html".into(),
            value: AttrValue::Interp(expr.clone()),
            ..Default::default()
        }]),
        Directive::Text { expr } => Ok(vec![TemplateAttr {
            name: "text".into(),
            value: AttrValue::Interp(expr.clone()),
            ..Default::default()
        }]),
        Directive::Show { expr } => Ok(vec![TemplateAttr {
            name: "show".into(),
            value: AttrValue::Interp(expr.clone()),
            ..Default::default()
        }]),
        Directive::Model { arg, expr, modifiers } => {
            // The write-back handler assigns `(expr) = value`; a non-assignable
            // target would emit invalid JS that only fails after build.
            if !is_assignable_model_target(expr) {
                return Err(TemplateParseError::coded(
                    "vmz::template::v_model_invalid_target",
                    offset,
                )
                .with_arg("expr", expr));
            }
            // `v-model` never binds a file input: browsers expose only a fake
            // path through `.value`, so the write-back silently corrupts state.
            if tag == "input"
                && static_attr_value(attrs, "type").is_some_and(|t| t.eq_ignore_ascii_case("file"))
            {
                return Err(TemplateParseError::coded(
                    "vmz::template::v_model_on_file_input",
                    offset,
                ));
            }
            // Native form elements bind the DOM `value` / `checked` prop and a
            // native write-back event. Only component tags keep the Vue 3
            // `:modelValue` + `@update:modelValue` contract.
            if let Some(bind) = native_model_bind(
                tag,
                arg.as_deref(),
                expr,
                modifiers,
                static_attr_value(attrs, "type"),
                bound_attr_expr(attrs, "value"),
                static_attr_value(attrs, "value"),
                static_attr_value(attrs, "multiple").is_some()
                    || bound_attr_expr(attrs, "multiple").is_some(),
            ) {
                return Ok(vec![
                    TemplateAttr {
                        name: bind.prop.into(),
                        value: AttrValue::Interp(bind.prop_expr),
                        ..Default::default()
                    },
                    TemplateAttr {
                        name: format!("@{}", bind.event),
                        value: AttrValue::Interp(bind.handler),
                        ..Default::default()
                    },
                ]);
            }
            // Vue 3 contract: v-model → :modelValue + @update:modelValue;
            // v-model:arg → :arg + @update:arg.
            let prop = arg.clone().unwrap_or_else(|| "modelValue".into());
            Ok(vec![
                TemplateAttr {
                    name: prop.clone(),
                    value: AttrValue::Interp(expr.clone()),
                    modifiers: modifiers.clone(),
                },
                TemplateAttr {
                    name: format!("@update:{prop}"),
                    value: AttrValue::Interp(format!("$event => (({expr}) = $event)")),
                    modifiers: modifiers.clone(),
                },
            ])
        }
        Directive::Pre => {
            // `lower_node` intercepts every element carrying `v-pre` before any
            // attribute lowering, so this arm is unreachable. Keep the authored
            // marker rather than fabricating a value if that invariant ever breaks.
            debug_assert!(false, "`v-pre` must be intercepted before attribute lowering");
            Ok(vec![TemplateAttr {
                name: "v-pre".into(),
                value: AttrValue::Static(String::new()),
                ..Default::default()
            }])
        }
        Directive::Once => {
            // `v-once` is carried to emit as a bare region marker attribute so Direct
            // emit can stop subscribing to bindings inside the subtree.
            Ok(vec![TemplateAttr {
                name: "v-once".into(),
                value: AttrValue::Static(String::new()),
                ..Default::default()
            }])
        }
        Directive::Memo { deps } => {
            // `v-memo` carries its dependency array as the marker value: emit reads it
            // to build the per-subtree snapshot gate, so the marker itself is not a prop.
            Ok(vec![TemplateAttr {
                name: "v-memo".into(),
                value: AttrValue::Static(deps.clone()),
                ..Default::default()
            }])
        }
        Directive::Custom { name, arg, expr, modifiers } => {
            // Preserve as static-ish attrs so we don't silently drop; use v-name[:arg].
            let ir_name = match arg {
                None => format!("v-{name}"),
                Some(DirectiveArg::Static(a)) => format!("v-{name}:{a}"),
                Some(DirectiveArg::Dynamic(_)) => {
                    return Err(TemplateParseError::coded(
                        "vmz::template::illegal_directive",
                        offset,
                    )
                    .with_arg("directive", format!("v-{name}")));
                }
            };
            Ok(vec![TemplateAttr {
                name: ir_name,
                value: AttrValue::Static(expr.clone().unwrap_or_default()),
                modifiers: modifiers.clone(),
            }])
        }
    }
}

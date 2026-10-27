//! Adapter: Concrete AST → legacy [`TemplateIr`] (emit contract unchanged).

use super::template_common::TemplateParseError;
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg};
use super::template_ir::{AttrValue, TemplateAttr, TemplateIr, TemplateNode};

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
            let mut ir_attrs = Vec::new();
            for attr in attrs {
                ir_attrs.extend(lower_attr(attr)?);
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

fn lower_attr(attr: &ConcreteAttr) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    match attr {
        ConcreteAttr::Static { name, value, .. } => Ok(vec![TemplateAttr {
            name: name.clone(),
            value: AttrValue::Static(value.clone()),
            ..Default::default()
        }]),
        ConcreteAttr::Directive { dir, span } => lower_directive(dir, span.start as usize),
    }
}

fn lower_directive(
    dir: &Directive,
    offset: usize,
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
            // `v-pre` is consumed as a verbatim region marker on Semantic; legacy
            // TemplateIr keeps it as a static-ish attribute for round-trip parity.
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

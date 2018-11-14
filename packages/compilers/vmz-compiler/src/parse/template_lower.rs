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
                Ok(Some(TemplateNode::Text(value.clone())))
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

fn lower_attr(attr: &ConcreteAttr) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    match attr {
        ConcreteAttr::Static { name, value, .. } => {
            Ok(vec![TemplateAttr { name: name.clone(), value: AttrValue::Static(value.clone()) }])
        }
        ConcreteAttr::Directive { dir, span } => lower_directive(dir, span.start as usize),
    }
}

fn lower_directive(
    dir: &Directive,
    offset: usize,
) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    match dir {
        Directive::If { test } => {
            Ok(vec![TemplateAttr { name: "if".into(), value: AttrValue::Interp(test.clone()) }])
        }
        Directive::ElseIf { test } => Ok(vec![TemplateAttr {
            name: "else-if".into(),
            value: AttrValue::Interp(test.clone()),
        }]),
        Directive::Else => {
            Ok(vec![TemplateAttr { name: "else".into(), value: AttrValue::Static(String::new()) }])
        }
        Directive::For { source, value_alias, .. } => Ok(vec![
            TemplateAttr { name: "each".into(), value: AttrValue::Interp(source.clone()) },
            TemplateAttr { name: "as".into(), value: AttrValue::Static(value_alias.clone()) },
        ]),
        Directive::Bind { arg, expr, modifiers: _ } => {
            let ir_name = match arg {
                DirectiveArg::Static(s) if s == "key" => "key".to_string(),
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            Ok(vec![TemplateAttr { name: ir_name, value: AttrValue::Interp(expr.clone()) }])
        }
        Directive::BindObject { expr } => {
            Ok(vec![TemplateAttr { name: "v-bind".into(), value: AttrValue::Interp(expr.clone()) }])
        }
        Directive::On { arg, handler, modifiers: _ } => {
            // Modifiers stay on Concrete only; IR event name is bare `@event` or `@[dyn]`.
            let event = match arg {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            Ok(vec![TemplateAttr {
                name: format!("@{event}"),
                value: AttrValue::Interp(handler.clone()),
            }])
        }
        Directive::OnObject { expr } => {
            Ok(vec![TemplateAttr { name: "v-on".into(), value: AttrValue::Interp(expr.clone()) }])
        }
        Directive::Slot { name, props } => {
            let slot_name = match name {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(_) => {
                    return Err(TemplateParseError {
                        message:
                            "dynamic `v-slot` argument is not supported in legacy IR adapter yet"
                                .into(),
                        offset,
                    });
                }
            };
            Ok(vec![TemplateAttr {
                name: format!("#{slot_name}"),
                value: AttrValue::Static(props.clone().unwrap_or_default()),
            }])
        }
        Directive::Html { expr } => {
            Ok(vec![TemplateAttr { name: "html".into(), value: AttrValue::Interp(expr.clone()) }])
        }
        Directive::Show { expr } => {
            Ok(vec![TemplateAttr { name: "show".into(), value: AttrValue::Interp(expr.clone()) }])
        }
        Directive::Model { arg, expr, modifiers: _ } => {
            // Vue 3 contract: v-model → :modelValue + @update:modelValue;
            // v-model:arg → :arg + @update:arg.
            let prop = arg.clone().unwrap_or_else(|| "modelValue".into());
            Ok(vec![
                TemplateAttr { name: prop.clone(), value: AttrValue::Interp(expr.clone()) },
                TemplateAttr {
                    name: format!("@update:{prop}"),
                    value: AttrValue::Interp(format!("$event => (({expr}) = $event)")),
                },
            ])
        }
        Directive::Custom { name, arg, expr, modifiers: _ } => {
            // Preserve as static-ish attrs so we don't silently drop; use v-name[:arg].
            let ir_name = match arg {
                None => format!("v-{name}"),
                Some(DirectiveArg::Static(a)) => format!("v-{name}:{a}"),
                Some(DirectiveArg::Dynamic(_)) => {
                    return Err(TemplateParseError {
                        message: format!(
                            "dynamic argument on custom directive `v-{name}` is not supported in legacy IR adapter yet"
                        ),
                        offset,
                    });
                }
            };
            Ok(vec![TemplateAttr {
                name: ir_name,
                value: AttrValue::Static(expr.clone().unwrap_or_default()),
            }])
        }
    }
}

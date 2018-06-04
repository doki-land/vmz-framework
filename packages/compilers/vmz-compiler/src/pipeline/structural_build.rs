//! Build Native View structural tree from TemplateIr + Reactive .
//!
//! TemplateIr is consumed **once** here. Direct emit must walk [`ViewView::roots`] only.

use vmz_types::{
    BindingId, BindingKind, ReactiveComponent, ViewAttr, ViewAttrValue, ViewEach, ViewIfBranch,
    ViewNode, ViewStatus, ViewView,
};

use crate::emit::{attr_interp, attr_static, has_bare_attr, is_component_tag, is_event_attr};
use crate::emit_ir::IrDepCursor;
use crate::pipeline::link::RouteTable;
use crate::template::{AttrValue, TemplateAttr, TemplateIr, TemplateNode};

/// Lift template structure onto the Program Graph view, correlating Reactive binding ids.
pub fn build_native_view(
    template: &TemplateIr,
    reactive: &ReactiveComponent,
    routes: Option<&RouteTable>,
) -> ViewView {
    let mut cursor = IrDepCursor::new(reactive);
    let roots = build_nodes(&template.roots, &mut cursor, routes);
    ViewView {
        status: ViewStatus::Native,
        binding_ids: reactive.bindings.iter().map(|b| b.id()).collect(),
        region_ids: reactive.control_regions.iter().map(|r| r.id).collect(),
        roots,
    }
}

fn build_nodes(
    nodes: &[TemplateNode],
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> Vec<ViewNode> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < nodes.len() {
        if matches!(&nodes[i], TemplateNode::Text(t) if t.trim().is_empty()) {
            i += 1;
            continue;
        }
        if let TemplateNode::Element { attrs, .. } = &nodes[i] {
            if let Some(cond) = attr_interp(attrs, "if") {
                let mut branches: Vec<(Option<String>, &TemplateNode)> = Vec::new();
                branches.push((Some(cond.clone()), &nodes[i]));
                let mut j = i + 1;
                loop {
                    while j < nodes.len()
                        && matches!(&nodes[j], TemplateNode::Text(t) if t.trim().is_empty())
                    {
                        j += 1;
                    }
                    if j >= nodes.len() {
                        break;
                    }
                    let TemplateNode::Element { attrs: a2, .. } = &nodes[j] else {
                        break;
                    };
                    if let Some(elseif_cond) = attr_interp(a2, "else-if") {
                        branches.push((Some(elseif_cond), &nodes[j]));
                        j += 1;
                        continue;
                    }
                    if has_bare_attr(a2, "else") {
                        branches.push((None, &nodes[j]));
                        j += 1;
                    }
                    break;
                }
                // Consume IfCond before body bindings (same order as emit_direct).
                let taken = ir.take_if(&sanitize(&cond));
                let binding = taken.as_ref().and_then(|t| t.binding_id.map(BindingId));
                let region = binding.and_then(|id| ir.binding_region(id.0));

                let mut view_branches = Vec::new();
                for (idx, (c, node)) in branches.iter().enumerate() {
                    let strip: &[&str] = if idx == 0 {
                        &["if"]
                    } else if c.is_some() {
                        &["else-if"]
                    } else {
                        &["else"]
                    };
                    // Branch bodies may be PascalCase components (Alert / DaVinciChart) —
                    // must not force build_element, or emit falls back to api.el("Foo").
                    view_branches.push(ViewIfBranch {
                        cond: c.clone().map(|s| sanitize(&s)),
                        body: Box::new(build_branch_body(node, strip, ir, routes)),
                    });
                }
                out.push(ViewNode::If { region, binding, branches: view_branches });
                i = j;
                continue;
            }
        }
        out.push(build_node(&nodes[i], ir, routes));
        i += 1;
    }
    out
}

fn build_node(
    node: &TemplateNode,
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    match node {
        TemplateNode::Text(t) => ViewNode::Text { value: t.clone() },
        TemplateNode::Interp(expr) => {
            let e = sanitize(expr);
            let binding = ir.take_binding(&[BindingKind::Text], &e).map(|t| BindingId(t.id));
            ViewNode::Interp { expr: e, binding }
        }
        TemplateNode::Element { tag, .. } => {
            if tag == "Link" {
                build_link(node, ir, routes)
            } else if is_component_tag(tag) {
                build_component(node, ir, routes)
            } else if tag.eq_ignore_ascii_case("slot") {
                build_slot(node, ir, routes)
            } else {
                build_element(node, &[], true, ir, routes)
            }
        }
    }
}

/// Same-app `<Link>` lowers to `<a href>` via RouteTable. Cross-app (`application=`) stays Component.
fn build_link(
    node: &TemplateNode,
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    let TemplateNode::Element { tag, attrs, children } = node else {
        return ViewNode::Text { value: String::new() };
    };
    if attr_static(attrs, "application").is_some() || attr_interp(attrs, "application").is_some() {
        return build_component(node, ir, routes);
    }

    let to = attr_static(attrs, "to");
    let params_expr = attr_interp(attrs, "params");
    let href = match (to.as_deref(), routes) {
        (Some(route_id), Some(table)) => {
            let params = match params_expr.as_deref() {
                None => Some(std::collections::BTreeMap::new()),
                Some(expr) => crate::pipeline::link::parse_static_link_params(expr),
            };
            match params {
                Some(map) => crate::pipeline::link::resolve_link_href(route_id, &map, table).ok(),
                None => None,
            }
        }
        _ => None,
    };

    if let Some(href) = href {
        let route_id = to.clone().unwrap_or_default();
        let strip = ["to", "params", "search", "hash", "replace", "prefetch", "state"];
        let mut view_attrs = build_attrs("a", attrs, &strip, false, ir);
        view_attrs.insert(
            0,
            ViewAttr {
                name: "href".into(),
                value: ViewAttrValue::Static { value: href },
                binding: None,
            },
        );
        // Client SPA takeover: same-app Link carries stable RouteId for intercept.
        if !route_id.is_empty() {
            view_attrs.insert(
                1,
                ViewAttr {
                    name: "data-vmz-route".into(),
                    value: ViewAttrValue::Static { value: route_id },
                    binding: None,
                },
            );
        }
        let kids = build_nodes(children, ir, routes);
        return ViewNode::Element {
            tag: "a".into(),
            attrs: view_attrs,
            children: kids,
            each: None,
        };
    }

    // Unresolved / dynamic Link — keep as Component until Route Graph covers it.
    let _ = tag;
    build_component(node, ir, routes)
}

fn build_branch_body(
    node: &TemplateNode,
    strip: &[&str],
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    match node {
        TemplateNode::Element { tag, .. } if tag == "Link" => {
            // Link with if/else: strip control attrs then reuse Link lowering.
            build_link_stripped(node, strip, ir, routes)
        }
        TemplateNode::Element { tag, .. } if is_component_tag(tag) => {
            build_component_stripped(node, strip, ir, routes)
        }
        TemplateNode::Element { .. } => build_element(node, strip, true, ir, routes),
        _ => build_node(node, ir, routes),
    }
}

fn build_component(
    node: &TemplateNode,
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    build_component_stripped(node, &[], ir, routes)
}

fn build_component_stripped(
    node: &TemplateNode,
    strip: &[&str],
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    let TemplateNode::Element { tag, attrs, children } = node else {
        return ViewNode::Text { value: String::new() };
    };
    let view_attrs = build_attrs(tag, attrs, strip, false, ir);
    let kids = build_nodes(children, ir, routes);
    ViewNode::Component { tag: tag.clone(), attrs: view_attrs, children: kids }
}

fn build_link_stripped(
    node: &TemplateNode,
    strip: &[&str],
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    let _ = strip;
    build_link(node, ir, routes)
}

fn build_slot(
    node: &TemplateNode,
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    let TemplateNode::Element { tag: _, attrs, children } = node else {
        return ViewNode::Text { value: String::new() };
    };
    let name = attr_static(attrs, "name");
    let view_attrs = build_attrs("slot", attrs, &["name"], false, ir);
    let kids = build_nodes(children, ir, routes);
    ViewNode::Slot { name, attrs: view_attrs, children: kids }
}

fn build_element(
    node: &TemplateNode,
    strip: &[&str],
    allow_each: bool,
    ir: &mut IrDepCursor<'_>,
    routes: Option<&RouteTable>,
) -> ViewNode {
    let TemplateNode::Element { tag, attrs, children } = node else {
        return ViewNode::Text { value: String::new() };
    };

    let each_expr = if allow_each { attr_interp(attrs, "each") } else { None };
    let each_as = if allow_each { attr_static(attrs, "as") } else { None };
    let each_key = if allow_each { attr_interp(attrs, "key") } else { None };

    let each = if let (Some(list_expr), Some(as_name)) = (each_expr, each_as) {
        let list = sanitize(&list_expr);
        let list_binding =
            ir.take_binding(&[BindingKind::EachList], &list).map(|t| BindingId(t.id));
        let key_expr = each_key.as_ref().map(|k| sanitize(k));
        let key_binding = key_expr
            .as_ref()
            .and_then(|k| ir.take_binding(&[BindingKind::EachKey], k).map(|t| BindingId(t.id)));
        Some(ViewEach {
            list_expr: list,
            as_name,
            key_expr,
            list_binding,
            key_binding,
            region: list_binding.and_then(|id| ir.binding_region(id.0)),
        })
    } else {
        None
    };

    let view_attrs = build_attrs(tag, attrs, strip, allow_each, ir);
    let kids = build_nodes(children, ir, routes);
    ViewNode::Element { tag: tag.clone(), attrs: view_attrs, children: kids, each }
}

fn build_attrs(
    tag: &str,
    attrs: &[TemplateAttr],
    strip: &[&str],
    strip_each: bool,
    ir: &mut IrDepCursor<'_>,
) -> Vec<ViewAttr> {
    // TW: merge static `style:tw` tokens into `class`; never keep `style:tw` on the View.
    let mut tw_tokens: Vec<String> = Vec::new();
    for a in attrs {
        if a.name == "style:tw" {
            if let AttrValue::Static(s) = &a.value {
                for t in s.split_whitespace() {
                    if !t.is_empty() {
                        tw_tokens.push(t.to_string());
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    let mut class_seen = false;
    for a in attrs {
        if strip.iter().any(|s| *s == a.name) {
            continue;
        }
        if strip_each && matches!(a.name.as_str(), "each" | "as" | "key") {
            continue;
        }
        if matches!(a.name.as_str(), "if" | "else-if" | "else") {
            continue;
        }
        if a.name == "style:tw" {
            continue;
        }
        match &a.value {
            AttrValue::Static(s) => {
                let mut value_text = s.clone();
                if matches!(a.name.as_str(), "class" | "className") && !tw_tokens.is_empty() {
                    class_seen = true;
                    if !value_text.is_empty() {
                        value_text.push(' ');
                    }
                    value_text.push_str(&tw_tokens.join(" "));
                }
                let value = if value_text.is_empty() && a.name == "else" {
                    ViewAttrValue::Bare
                } else if value_text.is_empty() {
                    ViewAttrValue::Bare
                } else {
                    ViewAttrValue::Static { value: value_text }
                };
                out.push(ViewAttr { name: a.name.clone(), value, binding: None });
            }
            AttrValue::Interp(e) => {
                let se = sanitize(e);
                let binding = if is_event_attr(&a.name) {
                    ir.take_binding(&[BindingKind::Event], &se).map(|t| BindingId(t.id))
                } else if is_component_tag(tag) {
                    ir.take_binding(&[BindingKind::ComponentProp], &se).map(|t| BindingId(t.id))
                } else {
                    ir.take_binding(&[BindingKind::Attr], &se)
                        .or_else(|| ir.take_binding(&[BindingKind::Text, BindingKind::Attr], &se))
                        .map(|t| BindingId(t.id))
                };
                out.push(ViewAttr {
                    name: a.name.clone(),
                    value: ViewAttrValue::Interp { expr: se },
                    binding,
                });
            }
        }
    }
    if !tw_tokens.is_empty() && !class_seen {
        out.push(ViewAttr {
            name: "class".into(),
            value: ViewAttrValue::Static { value: tw_tokens.join(" ") },
            binding: None,
        });
    }
    out
}

fn sanitize(expr: &str) -> String {
    crate::emit::sanitize_interp(expr)
}

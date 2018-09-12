//! Direct create/patch codegen from Native View (Native View / production Direct emit).
//!
//! Eligible Native View trees emit `__vmzCreate(api)` so mount/SSR/hydrate/resume
//! share one schedule. Structure comes from [`ViewView::roots`] only -- not TemplateIr.
//! Coverage: element / text / attr / event / if / each / ternary / component / slot.
//! Production products do **not** emit blueprint `render` (production Direct emit full close).

#![allow(clippy::too_many_arguments)]

use super::ast_util::{js_string_literal, print_one_stmt};
use super::emit_ir::IrDepCursor;
use super::helpers::{
    bind_field_idents, collect_deps_oxc, event_dom_type, is_event_attr, is_html_attr,
    looks_like_ternary, parse_this_method_call_arrow, sanitize_interp, split_ternary_parts,
    wrap_event_handler_body,
};
use vmz_types::{BindingId, ViewAttr, ViewAttrValue, ViewEach, ViewNode, ViewStatus, ViewView};

fn q(s: &str) -> String {
    js_string_literal(s)
}

fn deps_js(deps: &[String]) -> String {
    deps.iter().map(|d| q(d)).collect::<Vec<_>>().join(", ")
}

/// True when the Native View can be compiled to `__vmzCreate`.
pub fn is_direct_eligible(view: &ViewView) -> bool {
    view.status == ViewStatus::Native && nodes_eligible(&view.roots)
}

fn nodes_eligible(nodes: &[ViewNode]) -> bool {
    nodes.iter().all(node_eligible)
}

fn node_eligible(node: &ViewNode) -> bool {
    match node {
        ViewNode::Text { .. } | ViewNode::Interp { .. } => true,
        ViewNode::Element { attrs, children, .. } => {
            for a in attrs {
                if let ViewAttrValue::Interp { expr: e } = &a.value
                    && !is_event_attr(&a.name)
                {
                    let _ = e; // ternary attrs allowed (CF bind)
                }
            }
            nodes_eligible(children)
        }
        ViewNode::If { branches, .. } => branches.iter().all(|b| node_eligible(&b.body)),
        ViewNode::Component { children, .. } | ViewNode::Slot { children, .. } => {
            nodes_eligible(children)
        }
    }
}

/// Emit `__vmzDirect` + `__vmzCreate(api)` from Native View roots.
///
/// Create body statements for static text/element/attr/fragment are built with
/// oxc AstBuilder (`print_one_stmt`). Control-flow / interp / events still lower
/// as text, then the whole `__vmzCreate` function is parsed once. Outer
/// `name.__vmz*` assignments are AstBuilder + single codegen (no soft fallback).
/// SSR reuses the same create function with a serialize host API.
pub fn emit_direct_create(
    name: &str,
    view: &ViewView,
    fields: &[String],
    ir: &mut IrDepCursor<'_>,
) -> String {
    use super::ast_util::JsAst;
    use oxc_allocator::{Allocator, ArenaVec, CloneIn};
    use oxc_ast::ast::Statement;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    let mut next_id = 0u32;
    let body = emit_create_body(&view.roots, fields, &[], &[], 0, ir, &mut next_id);
    let fn_src = format!("(function __vmzCreate(api) {{\n{body}}})");

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &fn_src, SourceType::cjs()).parse();
    if parsed.panicked {
        panic!(
            "vmz-generator: Direct create body failed oxc parse for `{name}` ({} bytes)",
            fn_src.len()
        );
    }
    let create_expr = match parsed.program.body.first() {
        Some(Statement::ExpressionStatement(stmt)) => stmt.expression.clone_in(&allocator),
        _ => panic!("vmz-generator: Direct create expected function expression for `{name}`"),
    };

    let b = JsAst::new(&allocator);
    let stmts = ArenaVec::from_iter_in(
        [
            b.assign_member_stmt(name, "__vmzDirect", b.bool_lit(true)),
            b.assign_member_stmt(name, "__vmzCreate", create_expr),
            b.assign_member_stmt(name, "__vmzSerialize", b.member(name, "__vmzCreate")),
        ],
        &b.ast,
    );
    format!("\n{}", b.print_stmts(stmts))
}

/// Emit `__vmzPlan` literal matching `units[].plan` in program.json (shared identity).
///
/// Built via oxc AstBuilder + codegen (not `format!`).
pub fn emit_vmz_plan(name: &str, plan: &vmz_types::ExecutionPlan) -> String {
    use super::ast_util::JsAst;
    use oxc_allocator::{Allocator, ArenaVec};
    use oxc_ast::ast::ArrayExpressionElement;
    use oxc_span::SPAN;
    use vmz_protocol::PLAN_SCHEMA;
    let allocator = Allocator::default();
    let b = JsAst::new(&allocator);
    let mut node_elems = ArenaVec::with_capacity_in(plan.nodes.len(), &b.ast);
    for n in &plan.nodes {
        let tag = match n.tag() {
            Some(t) => b.str_lit(t),
            None => b.null_lit(),
        };
        let binding = n.binding().map(|id| b.num_lit(id)).unwrap_or_else(|| b.null_lit());
        let region = n.region().map(|id| b.num_lit(id)).unwrap_or_else(|| b.null_lit());
        let props = ArenaVec::from_iter_in(
            [
                b.prop("id", b.num_lit(n.id())),
                b.prop("kind", b.str_lit(n.kind().as_str())),
                b.prop("binding", binding),
                b.prop("region", region),
                b.prop("tag", tag),
                b.prop("children", b.u32_array(n.children())),
                b.prop("branches", b.u32_array(n.branches())),
            ],
            &b.ast,
        );
        node_elems.push(ArrayExpressionElement::from(b.object(props)));
    }
    let plan_props = ArenaVec::from_iter_in(
        [
            b.prop("schema", b.str_lit(PLAN_SCHEMA)),
            b.prop("status", b.str_lit(plan.status.as_str())),
            b.prop("root_ids", b.u32_array(&plan.root_ids)),
            b.prop(
                "nodes",
                oxc_ast::ast::Expression::new_array_expression(SPAN, node_elems, &b.ast),
            ),
        ],
        &b.ast,
    );
    let stmt = b.assign_member_stmt(name, "__vmzPlan", b.object(plan_props));
    let body = ArenaVec::from_iter_in([stmt], &b.ast);
    format!("\n{}", b.print_stmts(body))
}

fn emit_create_body(
    nodes: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    next_id: &mut u32,
) -> String {
    let mut stmts = Vec::new();
    let roots = emit_nodes(nodes, fields, scope, aliases, each_depth, ir, &mut stmts, next_id);
    let return_expr = match roots.len() {
        0 => "null".to_string(),
        1 => roots[0].clone(),
        _ => {
            let frag = fresh("f", next_id);
            stmts.insert(0, print_one_stmt(|b| b.var_stmt(&frag, b.api_call("frag", vec![]))));
            for r in &roots {
                let child = r.clone();
                stmts.push(print_one_stmt(|b| {
                    b.expr_stmt(b.call(b.member(&frag, "appendChild"), vec![b.ident(&child)]))
                }));
            }
            frag
        }
    };
    format!("{}  return {};\n", indent_block(&stmts.join("\n")), return_expr)
}

fn indent_block(s: &str) -> String {
    if s.is_empty() {
        return String::new();
    }
    s.lines().map(|l| format!("  {l}\n")).collect()
}

fn fresh(prefix: &str, next_id: &mut u32) -> String {
    let id = *next_id;
    *next_id += 1;
    format!("{prefix}{id}")
}

fn binding_deps(
    ir: &IrDepCursor<'_>,
    id: Option<BindingId>,
    fallback_expr: &str,
    fields: &[String],
    scope: &[String],
) -> (Option<u32>, Vec<String>) {
    if let Some(bid) = id {
        let deps = ir.deps_for_binding(bid.0).unwrap_or_default();
        return (Some(bid.0), deps);
    }
    (None, collect_deps_oxc(fallback_expr, fields, scope))
}

fn emit_nodes(
    nodes: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> Vec<String> {
    let mut out = Vec::new();
    for node in nodes {
        out.push(emit_node(node, fields, scope, aliases, each_depth, ir, stmts, next_id));
    }
    out
}

fn emit_node(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    match node {
        ViewNode::Text { value: t } => {
            let v = fresh("t", next_id);
            let text = t.clone();
            stmts.push(print_one_stmt(|b| {
                b.var_stmt(&v, b.api_call("text", vec![b.str_lit(&text)]))
            }));
            v
        }
        ViewNode::Interp { expr, binding } => {
            emit_bind_text(expr, *binding, fields, scope, aliases, ir, stmts, next_id)
        }
        ViewNode::Element { .. } => {
            emit_element(node, fields, scope, aliases, each_depth, ir, stmts, next_id)
        }
        ViewNode::If { .. } => {
            emit_if_block(node, fields, scope, aliases, each_depth, ir, stmts, next_id)
        }
        ViewNode::Component { tag, attrs, children } => emit_component(
            tag, attrs, children, fields, scope, aliases, each_depth, ir, stmts, next_id,
        ),
        ViewNode::Slot { name, attrs, children } => {
            let mut attrs = attrs.clone();
            if let Some(n) = name
                && !attrs.iter().any(|a| a.name == "name")
            {
                attrs.insert(
                    0,
                    ViewAttr {
                        name: "name".into(),
                        value: ViewAttrValue::Static { value: n.clone() },
                        binding: None,
                    },
                );
            }
            emit_plain_element(
                "slot", &attrs, children, fields, scope, aliases, each_depth, ir, stmts, next_id,
            )
        }
    }
}

fn emit_if_block(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let ViewNode::If { binding, branches, region } = node else {
        return "null".to_string();
    };
    let first_cond = branches.iter().find_map(|b| b.cond.as_deref()).unwrap_or("");
    let (binding_id, all_deps) = binding_deps(ir, *binding, first_cond, fields, scope);
    let deps = deps_js(&all_deps);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    let region_arg = region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
    let mut branch_objs = Vec::new();
    for br in branches {
        let create_fn =
            emit_branch_create_fn(&br.body, fields, scope, aliases, each_depth, ir, next_id);
        match &br.cond {
            Some(c) => {
                let expr = bind_field_idents(c, fields, scope, aliases);
                branch_objs.push(format!(
                    "{{ cond: function() {{ return ({expr}); }}, create: {create_fn} }}"
                ));
            }
            None => {
                branch_objs.push(format!("{{ create: {create_fn} }}"));
            }
        }
    }
    let v = fresh("i", next_id);
    stmts.push(format!(
        "var {v} = api.ifBlock(this, {id_arg}, [{deps}], [{}], {region_arg});",
        branch_objs.join(", ")
    ));
    v
}

fn emit_branch_create_fn(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    next_id: &mut u32,
) -> String {
    let mut stmts = Vec::new();
    let root = emit_node(node, fields, scope, aliases, each_depth, ir, &mut stmts, next_id);
    format!("function(api) {{\n{}  return {root};\n}}", indent_block(&stmts.join("\n")))
}

fn emit_element(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let ViewNode::Element { tag, attrs, children, each } = node else {
        return "null".to_string();
    };
    if let Some(each) = each {
        return emit_each_block(
            tag, attrs, children, each, fields, scope, aliases, each_depth, ir, stmts, next_id,
        );
    }
    emit_plain_element(tag, attrs, children, fields, scope, aliases, each_depth, ir, stmts, next_id)
}

fn emit_plain_element(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let el = fresh("e", next_id);
    let tag_owned = tag.to_string();
    stmts.push(print_one_stmt(|b| b.var_stmt(&el, b.api_call("el", vec![b.str_lit(&tag_owned)]))));
    for a in attrs {
        if a.name == "style:tw" {
            continue;
        }
        match &a.value {
            ViewAttrValue::Static { value: s } if is_html_attr(&a.name) => {
                let html = s.clone();
                stmts.push(print_one_stmt(|b| {
                    b.expr_stmt(b.api_call("setHtml", vec![b.ident(&el), b.str_lit(&html)]))
                }));
            }
            ViewAttrValue::Static { value: s } => {
                let attr_name = if a.name == "className" { "class" } else { a.name.as_str() };
                let name = attr_name.to_string();
                let val = s.clone();
                stmts.push(print_one_stmt(|b| {
                    b.expr_stmt(
                        b.api_call("attr", vec![b.ident(&el), b.str_lit(&name), b.str_lit(&val)]),
                    )
                }));
            }
            ViewAttrValue::Bare => {}
            ViewAttrValue::Interp { expr: e } if is_event_attr(&a.name) => {
                let body = bind_field_idents(e, fields, scope, aliases);
                let type_name = event_dom_type(&a.name);
                if let Some(method) = parse_this_method_call_arrow(&body) {
                    // `() => this.foo()` / `(ev) => this.foo(ev)` ? onMethod (no arrow IC).
                    stmts.push(format!("api.onMethod({el}, {}, {});", q(&type_name), q(&method)));
                } else {
                    let handler = wrap_event_handler_body(&body);
                    stmts.push(format!("api.on({el}, {}, {handler});", q(&type_name)));
                }
            }
            ViewAttrValue::Interp { expr: e } if is_html_attr(&a.name) => {
                emit_bind_html(e, a.binding, &el, fields, scope, aliases, ir, stmts);
            }
            ViewAttrValue::Interp { expr: e } => {
                emit_bind_attr(e, a.binding, &a.name, &el, fields, scope, aliases, ir, stmts);
            }
        }
    }
    for child in emit_nodes(children, fields, scope, aliases, each_depth, ir, stmts, next_id) {
        stmts.push(print_one_stmt(|b| {
            b.expr_stmt(b.call(b.member(&el, "appendChild"), vec![b.ident(&child)]))
        }));
    }
    el
}

fn emit_component(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let mut client: Option<String> = None;
    let mut prop_parts = Vec::new();
    for a in attrs {
        if a.name == "style:tw" {
            continue;
        }
        if let Some(strategy) = a.name.strip_prefix("client:") {
            client = Some(if strategy.is_empty() { "load".into() } else { strategy.to_string() });
            continue;
        }
        let val = match &a.value {
            ViewAttrValue::Static { value: s } => q(s),
            ViewAttrValue::Bare => "true".to_string(),
            ViewAttrValue::Interp { expr: e } if is_event_attr(&a.name) => {
                wrap_event_handler_body(&bind_field_idents(e, fields, scope, aliases))
            }
            // Always rewrite bare field idents for complex interps (not a single field root).
            ViewAttrValue::Interp { expr: e } => bind_field_idents(e, fields, scope, aliases),
        };
        prop_parts.push(format!("{}:{}", q(&a.name), val));
    }
    let props = format!("{{{}}}", prop_parts.join(","));
    let client_arg = match &client {
        Some(c) => q(c),
        None => "null".into(),
    };
    let v = fresh("c", next_id);
    stmts.push(format!("var {v} = api.component(this, {}, {props}, {client_arg});", q(tag)));
    // Live prop binders: any interp with field deps stays in sync.
    if client.is_none() && aliases.is_empty() {
        for a in attrs {
            if a.name == "style:tw" || a.name.starts_with("client:") || is_event_attr(&a.name) {
                continue;
            }
            let ViewAttrValue::Interp { expr: e } = &a.value else {
                continue;
            };
            let deps = collect_deps_oxc(e, fields, scope);
            if deps.is_empty() {
                continue;
            }
            let deps = deps_js(&deps);
            let body = bind_field_idents(e, fields, scope, aliases);
            stmts.push(format!(
                "api.bindComponentProp(this, {v}, {}, [{deps}], function() {{ return {body}; }});",
                q(&a.name)
            ));
        }
    }
    // Default slot: project parent children into the child's first unnamed <slot>.
    if !children.is_empty() {
        let kids = emit_nodes(children, fields, scope, aliases, each_depth, ir, stmts, next_id);
        for kid in kids {
            stmts.push(format!("api.projectDefaultSlot({v}, {kid});"));
        }
    }
    v
}

fn emit_bind_attr(
    expr: &str,
    binding: Option<BindingId>,
    attr_name: &str,
    el: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    ir: &IrDepCursor<'_>,
    stmts: &mut Vec<String>,
) {
    let e = sanitize_interp(expr);
    let name = if attr_name == "className" { "class" } else { attr_name };
    let (binding_id, deps, cf_js) = bind_payload(&e, binding, fields, scope, aliases, ir);
    let deps = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindAttr(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {el}, {}, {cf});",
            q(name)
        ));
    } else {
        stmts.push(format!(
            "api.bindAttr(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {el}, {});",
            q(name)
        ));
    }
}

fn emit_bind_html(
    expr: &str,
    binding: Option<BindingId>,
    el: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    ir: &IrDepCursor<'_>,
    stmts: &mut Vec<String>,
) {
    let e = sanitize_interp(expr);
    let (binding_id, deps, cf_js) = bind_payload(&e, binding, fields, scope, aliases, ir);
    let deps = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindHtml(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {el}, {cf});"
        ));
    } else {
        stmts.push(format!(
            "api.bindHtml(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {el});"
        ));
    }
}

fn emit_each_block(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    each: &ViewEach,
    fields: &[String],
    outer_scope: &[String],
    outer_aliases: &[(String, String)],
    each_depth: u32,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let depth = each_depth + 1;
    let box_id = format!("box{depth}");
    let mut child_scope = outer_scope.to_vec();
    if !each.as_name.is_empty() && !child_scope.iter().any(|x| x == &each.as_name) {
        child_scope.push(each.as_name.clone());
    }
    if !child_scope.iter().any(|x| x == "index") {
        child_scope.push("index".into());
    }
    let mut child_aliases = outer_aliases.to_vec();
    child_aliases.retain(|(k, _)| k != &each.as_name && k != "index");
    child_aliases.push((each.as_name.clone(), format!("{box_id}.item")));
    child_aliases.push(("index".into(), format!("{box_id}.index")));
    let (binding_id, deps) =
        binding_deps(ir, each.list_binding, &each.list_expr, fields, outer_scope);
    let deps = deps_js(&deps);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    let list_body = bind_field_idents(&each.list_expr, fields, outer_scope, outer_aliases);
    let key_field = if let Some(k) = &each.key_expr {
        let kbody = bind_field_idents(k, fields, &child_scope, &child_aliases);
        format!("key: function({box_id}) {{ return ({kbody}); }}, ")
    } else {
        String::new()
    };
    let key_bound =
        each.key_expr.as_ref().map(|k| bind_field_idents(k, fields, &child_scope, &child_aliases));
    let row_kernel = super::row_kernel::try_emit_row_kernel_js(
        tag,
        attrs,
        children,
        &each.as_name,
        &box_id,
        fields,
        &child_scope,
        &child_aliases,
        key_bound.as_deref(),
    )
    .unwrap_or_default();
    // Client hot path: rowKernel.create / cloneNode. With a kernel, omit fat createItem to
    // shrink bundles — but still emit IR-homologous serializeItem for SSR (same schedule as
    // today's fat createItem). Do not treat rowKernel.html as SSR truth source.
    let item_fn = |ir: &mut IrDepCursor<'_>, next_id: &mut u32| {
        let mut item_stmts = Vec::new();
        let item_root = emit_plain_element(
            tag,
            attrs,
            children,
            fields,
            &child_scope,
            &child_aliases,
            depth,
            ir,
            &mut item_stmts,
            next_id,
        );
        format!(
            "function(api, {box_id}) {{\n{}  return {item_root};\n}}",
            indent_block(&item_stmts.join("\n"))
        )
    };
    let (create_item, serialize_item_field) = if row_kernel.is_empty() {
        (item_fn(ir, next_id), String::new())
    } else {
        let serialize_fn = item_fn(ir, next_id);
        ("null".to_string(), format!("serializeItem: {serialize_fn}, "))
    };
    let v = fresh("k", next_id);
    let region_arg = each.region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
    stmts.push(format!(
        "var {v} = api.eachBlock(this, {id_arg}, [{deps}], {{ list: function() {{ return ({list_body}); }}, {key_field}{row_kernel}{serialize_item_field}createItem: {create_item} }}, {region_arg});"
    ));
    v
}

fn emit_bind_text(
    expr: &str,
    binding: Option<BindingId>,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    ir: &IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> String {
    let e = sanitize_interp(expr);
    let (binding_id, deps, cf_js) = bind_payload(&e, binding, fields, scope, aliases, ir);
    let deps = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let v = fresh("t", next_id);
    stmts.push(format!("var {v} = api.text(\"\");"));
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindText(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {v}, {cf});"
        ));
    } else {
        stmts.push(format!(
            "api.bindText(this, {id_arg}, [{deps}], function() {{ return {body}; }}, {v});"
        ));
    }
    v
}

/// (bindingId, unionDeps, optional cf object JS)
fn bind_payload(
    expr: &str,
    binding: Option<BindingId>,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    ir: &IrDepCursor<'_>,
) -> (Option<u32>, Vec<String>, Option<String>) {
    if looks_like_ternary(expr)
        && let Some(bid) = binding
        && let Some(cf) = ir.control_flow_for_binding(bid.0)
        && let Some((test_src, _, _)) = split_ternary_parts(expr)
    {
        let stable =
            cf.branches.first().map(|b| b.cond_deps.clone()).unwrap_or_else(|| cf.stable.clone());
        let cons_deps = cf.branches.first().map(|b| b.body_deps.clone()).unwrap_or_default();
        let alt_deps = cf.branches.get(1).map(|b| b.body_deps.clone()).unwrap_or_default();
        let mut deps_all = cf.stable.clone();
        for d in stable.iter().chain(cons_deps.iter()).chain(alt_deps.iter()) {
            if !deps_all.iter().any(|x| x == d) {
                deps_all.push(d.clone());
            }
        }
        let stable_js = deps_js(&stable);
        let cons_js = deps_js(&cons_deps);
        let alt_js = deps_js(&alt_deps);
        let test_body = bind_field_idents(&test_src, fields, scope, aliases);
        let cf_js = format!(
            "{{ stable: [{stable_js}], branches: [{{ cond: function() {{ return ({test_body}); }}, deps: [{cons_js}] }},{{ deps: [{alt_js}] }}] }}"
        );
        return (Some(bid.0), deps_all, Some(cf_js));
    }
    let (id, deps) = binding_deps(ir, binding, expr, fields, scope);
    (id, deps, None)
}


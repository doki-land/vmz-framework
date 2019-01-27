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
    HandlerResolution, bind_field_idents, collect_deps_oxc, component_event_name,
    component_prop_wire_name, event_dom_type, is_component_event_attr, is_event_attr, is_html_attr,
    looks_like_ternary, parse_this_method_call_arrow, sanitize_interp, single_field_binding_target,
    split_ternary_parts, wrap_event_handler_body,
};
use std::collections::HashMap;

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

/// Class method / prop tables for handler resolution and specialized binding emit.
#[derive(Debug, Clone, Copy)]
pub struct ComponentHandlerCtx<'a> {
    /// Public instance method names on the authoring class.
    pub methods: &'a [String],
    /// Public prop names on the authoring class.
    pub props: &'a [String],
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
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    use super::ast_util::JsAst;
    use oxc_allocator::{Allocator, ArenaVec, CloneIn};
    use oxc_ast::ast::Statement;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    let mut next_id = 0u32;
    let body = emit_create_body(
        &view.roots,
        fields,
        &[],
        &[],
        0,
        handler_ctx,
        ir,
        &mut next_id,
        child_ctors,
    )?;
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
            b.assign_member_stmt(name, "__vmzTag", b.str_lit(name)),
            b.assign_member_stmt(name, "__vmzCreate", create_expr),
            b.assign_member_stmt(name, "__vmzSerialize", b.member(name, "__vmzCreate")),
        ],
        &b.ast,
    );
    Ok(format!("\n{}", b.print_stmts(stmts)))
}

fn parse_wrapped_instance_method(handler: &str) -> Option<String> {
    let rest = handler.trim().strip_prefix("(ev) => this.")?;
    let name = rest.split('(').next()?.trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return None;
    }
    let after = rest.strip_prefix(name)?.trim();
    if after == "(ev)" || after.starts_with("(ev)") {
        return Some(name.to_string());
    }
    None
}

fn handler_resolution<'a>(
    handler_ctx: ComponentHandlerCtx<'a>,
    scope: &'a [String],
) -> HandlerResolution<'a> {
    HandlerResolution { methods: handler_ctx.methods, props: handler_ctx.props, locals: scope }
}

fn wrap_handler(
    body: &str,
    handler_ctx: ComponentHandlerCtx<'_>,
    scope: &[String],
) -> Result<String, String> {
    wrap_event_handler_body(body, handler_resolution(handler_ctx, scope))
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
        let key_binding = n.key_binding().map(|id| b.num_lit(id)).unwrap_or_else(|| b.null_lit());
        let projection_id =
            n.projection_id().map(|id| b.num_lit(id)).unwrap_or_else(|| b.null_lit());
        let resume_marker = n.resume_marker().map(|s| b.str_lit(s)).unwrap_or_else(|| b.null_lit());
        let region = n.region().map(|id| b.num_lit(id)).unwrap_or_else(|| b.null_lit());
        let props = ArenaVec::from_iter_in(
            [
                b.prop("id", b.num_lit(n.id())),
                b.prop("kind", b.str_lit(n.kind().as_str())),
                b.prop("binding", binding),
                b.prop("keyBinding", key_binding),
                b.prop("projectionId", projection_id),
                b.prop("resumeMarker", resume_marker),
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
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let mut stmts = Vec::new();
    let roots = emit_nodes(
        nodes,
        fields,
        scope,
        aliases,
        each_depth,
        handler_ctx,
        ir,
        &mut stmts,
        next_id,
        child_ctors,
    )?;
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
    Ok(format!("{}  return {};\n", indent_block(&stmts.join("\n")), return_expr))
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
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for node in nodes {
        out.push(emit_node(
            node,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
        )?);
    }
    Ok(out)
}

fn emit_node(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    match node {
        ViewNode::Text { value: t } => {
            let v = fresh("t", next_id);
            let text = t.clone();
            stmts.push(print_one_stmt(|b| {
                b.var_stmt(&v, b.api_call("text", vec![b.str_lit(&text)]))
            }));
            Ok(v)
        }
        ViewNode::Interp { expr, binding } => {
            emit_bind_text(expr, *binding, fields, scope, aliases, handler_ctx, ir, stmts, next_id)
        }
        ViewNode::Element { .. } => emit_element(
            node,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
        ),
        ViewNode::If { .. } => emit_if_block(
            node,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
        ),
        ViewNode::Component { tag, attrs, children } => emit_component(
            tag,
            attrs,
            children,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
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
                "slot",
                &attrs,
                children,
                fields,
                scope,
                aliases,
                each_depth,
                handler_ctx,
                ir,
                stmts,
                next_id,
                child_ctors,
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
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let ViewNode::If { binding, branches, region } = node else {
        return Ok("null".to_string());
    };
    let first_cond = branches.iter().find_map(|b| b.cond.as_deref()).unwrap_or("");
    let (binding_id, all_deps) = binding_deps(ir, *binding, first_cond, fields, scope);
    let deps = deps_js(&all_deps);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    let region_arg = region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
    let mut branch_objs = Vec::new();
    for br in branches {
        let create_fn = emit_branch_create_fn(
            &br.body,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            next_id,
            child_ctors,
        )?;
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
        "var {v} = (function() {{
  var inst = this;
  var start = api.comment('vmz-if');
  var end = api.comment('/vmz-if');
  if ({region_arg} != null) start.__vmzRegion = {region_arg};
  var frag = api.frag();
  frag.appendChild(start);
  var regionHost = null;
  if ({region_arg} != null) {{
    regionHost = api.el('span');
    regionHost.style.display = 'contents';
    regionHost.setAttribute('data-vmz-region', String({region_arg}));
    frag.appendChild(regionHost);
  }}
  frag.appendChild(end);
  var branches = [{branch_objs}];
  var cached = branches.map(function() {{ return null; }});
  var branchBinds = branches.map(function() {{ return []; }});
  var active = -1;
  var gen = 0;
  function pick() {{
    for (var i = 0; i < branches.length; i++) {{
      var b = branches[i];
      if (!b.cond) return i;
      try {{ if (b.cond.call(inst)) return i; }} catch {{}}
    }}
    return -1;
  }}
  function wireBranch(idx) {{
    if (idx < 0) return;
    for (var j = 0; j < branchBinds[idx].length; j++) {{
      var bb = branchBinds[idx][j];
      api.trackPatch(inst, bb.deps, bb.fn, bb.bindingId);
    }}
  }}
  function unwireBranch(idx) {{
    if (idx < 0) return;
    for (var j = 0; j < branchBinds[idx].length; j++) {{
      var bb = branchBinds[idx][j];
      api.untrackPatch(inst, bb.deps, bb.fn, bb.bindingId);
    }}
  }}
  function apply() {{
    if (inst.__vmzDestroyed) return;
    var applied = ++gen;
    var next = pick();
    if (next === active) return;
    if (next >= 0 && !cached[next]) {{
      var binds = [];
      var prevSink = api._branchBinds;
      var prevInst = api._inst;
      api._branchBinds = binds;
      api._inst = inst;
      var created = null;
      var adopt = api._resumeAdopt;
      var endBranch = adopt && typeof adopt.beginBranchScope === 'function' ? adopt.beginBranchScope() : null;
      try {{ created = branches[next].create.call(inst, api); }} finally {{
        if (typeof endBranch === 'function') endBranch();
        api._branchBinds = prevSink;
        api._inst = prevInst;
      }}
      if (applied !== gen || inst.__vmzDestroyed) return;
      if (!cached[next]) {{ cached[next] = created; branchBinds[next] = binds; }}
    }}
    if (applied !== gen || inst.__vmzDestroyed) return;
    if (active >= 0) {{
      unwireBranch(active);
      if (cached[active] && cached[active].parentNode) api.removeNode(cached[active]);
    }}
    active = next;
    if (next < 0) return;
    wireBranch(next);
    if (cached[next] && end.parentNode) {{
      if (regionHost) regionHost.appendChild(cached[next]);
      else end.parentNode.insertBefore(cached[next], end);
    }}
  }}
  api.trackPatch(inst, [{deps}], apply, {id_arg});
  if (api._itemPatches) api._itemPatches.push(apply);
  start.__vmzDispose = function() {{
    for (var i = 0; i < cached.length; i++) {{
      unwireBranch(i);
      if (cached[i]) api.disposeTree(cached[i]);
      cached[i] = null;
    }}
    active = -1;
  }};
  apply();
  return frag;
}}).call(this);",
        v = v,
        region_arg = region_arg,
        branch_objs = branch_objs.join(", "),
        deps = deps,
        id_arg = id_arg
    ));
    Ok(v)
}

fn emit_branch_create_fn(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let mut stmts = Vec::new();
    let root = emit_node(
        node,
        fields,
        scope,
        aliases,
        each_depth,
        handler_ctx,
        ir,
        &mut stmts,
        next_id,
        child_ctors,
    )?;
    Ok(format!("function(api) {{\n{}  return {root};\n}}", indent_block(&stmts.join("\n"))))
}

fn emit_element(
    node: &ViewNode,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let ViewNode::Element { tag, attrs, children, each } = node else {
        return Ok("null".to_string());
    };
    if let Some(each) = each {
        return emit_each_block(
            tag,
            attrs,
            children,
            each,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
        );
    }
    emit_plain_element(
        tag,
        attrs,
        children,
        fields,
        scope,
        aliases,
        each_depth,
        handler_ctx,
        ir,
        stmts,
        next_id,
        child_ctors,
    )
}

fn emit_plain_element(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let el = fresh("e", next_id);
    let tag_owned = tag.to_string();
    stmts.push(print_one_stmt(|b| b.var_stmt(&el, b.api_call("el", vec![b.str_lit(&tag_owned)]))));
    stmts.push(print_one_stmt(|b| b.expr_stmt(b.api_call("adoptEnter", vec![b.ident(&el)]))));
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
                    stmts.push(format!("api.onMethod({el}, {}, {});", q(&type_name), q(&method)));
                } else {
                    let handler = wrap_handler(&body, handler_ctx, scope)?;
                    if let Some(method) = parse_wrapped_instance_method(&handler) {
                        stmts.push(format!(
                            "api.onMethod({el}, {}, {});",
                            q(&type_name),
                            q(&method)
                        ));
                    } else {
                        stmts.push(format!("api.on({el}, {}, {handler});", q(&type_name)));
                    }
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
    for child in emit_nodes(
        children,
        fields,
        scope,
        aliases,
        each_depth,
        handler_ctx,
        ir,
        stmts,
        next_id,
        child_ctors,
    )? {
        stmts.push(print_one_stmt(|b| {
            b.expr_stmt(b.call(b.member(&el, "appendChild"), vec![b.ident(&child)]))
        }));
    }
    stmts.push(print_one_stmt(|b| b.expr_stmt(b.api_call("adoptLeave", vec![]))));
    Ok(el)
}

fn emit_component(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    each_depth: u32,
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
    let mut client: Option<String> = None;
    let mut prop_parts = Vec::new();
    let mut event_parts: Vec<(String, String)> = Vec::new();
    for a in attrs {
        if a.name == "style:tw" {
            continue;
        }
        if let Some(strategy) = a.name.strip_prefix("client:") {
            client = Some(if strategy.is_empty() { "load".into() } else { strategy.to_string() });
            continue;
        }
        if is_component_event_attr(&a.name) {
            let ViewAttrValue::Interp { expr: e } = &a.value else {
                continue;
            };
            let body = bind_field_idents(e, fields, scope, aliases);
            let handler = wrap_handler(&body, handler_ctx, scope)?;
            event_parts.push((component_event_name(&a.name), handler));
            continue;
        }
        let val = match &a.value {
            ViewAttrValue::Static { value: s } => q(s),
            ViewAttrValue::Bare => "true".to_string(),
            ViewAttrValue::Interp { expr: e } => {
                let body = bind_field_idents(e, fields, scope, aliases);
                let wire = component_prop_wire_name(&a.name);
                if wire.starts_with("on")
                    && wire.len() > 2
                    && wire.as_bytes()[2].is_ascii_uppercase()
                {
                    wrap_handler(&body, handler_ctx, scope)?
                } else {
                    body
                }
            }
        };
        let wire = component_prop_wire_name(&a.name);
        prop_parts.push(format!("{}:{}", q(&wire), val));
    }
    let props = format!("{{{}}}", prop_parts.join(","));
    let client_arg = match &client {
        Some(c) => q(c),
        None => "null".into(),
    };
    let v = fresh("c", next_id);
    let ctor_arg = if child_ctors.contains_key(tag) {
        tag.to_string()
    } else if child_ctors.is_empty() {
        // Unit / no-graph path: keep string tag for registry lookup.
        q(tag)
    } else {
        return Err(format!("vmz: unknown component tag `{tag}` (not in ComponentGraph.by_tag)"));
    };
    stmts.push(format!("var {v} = api.component(this, {ctor_arg}, {props}, {client_arg});"));
    for (ev, handler) in &event_parts {
        stmts.push(format!("api.onComponentEvent({v}, {}, {handler});", q(ev)));
    }
    if client.is_none() && aliases.is_empty() {
        for a in attrs {
            if a.name == "style:tw"
                || a.name.starts_with("client:")
                || is_component_event_attr(&a.name)
            {
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
            let wire = component_prop_wire_name(&a.name);
            stmts.push(format!(
                "api.bindComponentProp(this, {v}, {}, [{deps}], function() {{ return {body}; }});",
                q(&wire)
            ));
        }
    }
    if !children.is_empty() {
        stmts.push(format!("api.adoptEnter({v});"));
        let kids = emit_nodes(
            children,
            fields,
            scope,
            aliases,
            each_depth,
            handler_ctx,
            ir,
            stmts,
            next_id,
            child_ctors,
        )?;
        for kid in kids {
            stmts.push(format!("api.projectDefaultSlot({v}, {kid});"));
        }
        stmts.push(format!("api.adoptLeave();"));
    }
    Ok(v)
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
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if cf_js.is_none()
        && let Some(field) = single_field_binding_target(&e, fields, scope, aliases)
    {
        stmts.push(format!("api.specFieldAttr(this, {id_arg}, {}, {el}, {});", q(&field), q(name)));
        return;
    }
    let deps_js = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let patch_name =
        format!("__patchAttr{}", binding_id.map(|id| id.to_string()).unwrap_or_else(|| "X".into()));
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "(function() {{
  var __cf = {cf};
  var __liveDeps = [{deps_js}];
  var __activeBranch = -1;
  function {patch_name}() {{
    var __raw;
    try {{ __raw = {body}; }} catch {{ __raw = null; }}
    api.attr({el}, {name_q}, __raw);
    if (!__cf || !__cf.branches) return;
    var __next = -1;
    for (var __i = 0; __i < __cf.branches.length; __i++) {{
      var __b = __cf.branches[__i];
      if (!__b.cond) {{ __next = __i; break; }}
      try {{ if (__b.cond.call(this)) {{ __next = __i; break; }} }} catch {{}}
    }}
    if (__next === __activeBranch) return;
    __activeBranch = __next;
    var __br = __cf.branches[__next];
    var __nd = [].concat(__cf.stable || []).concat((__br && __br.deps) || []);
    __nd = Array.from(new Set(__nd));
    api.untrackPatch(this, __liveDeps, {patch_name}, {id_arg});
    __liveDeps = __nd;
    api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
  }}
  api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
}}).call(this);",
            cf = cf,
            deps_js = deps_js,
            body = body,
            el = el,
            name_q = q(name),
            patch_name = patch_name,
            id_arg = id_arg
        ));
    } else {
        stmts.push(format!(
            "api.trackPatch(this, [{deps_js}], function() {{ var __v; try {{ __v = {body}; }} catch {{ __v = null; }} api.attr({el}, {name_q}, __v); }}, {id_arg});",
            deps_js = deps_js,
            body = body,
            el = el,
            name_q = q(name),
            id_arg = id_arg
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
    let deps_js = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    let patch_name =
        format!("__patchHtml{}", binding_id.map(|id| id.to_string()).unwrap_or_else(|| "X".into()));
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "(function() {{
  var __cf = {cf};
  var __liveDeps = [{deps_js}];
  var __activeBranch = -1;
  function {patch_name}() {{
    var __raw;
    try {{ __raw = {body}; }} catch {{ __raw = null; }}
    {el}.innerHTML = __raw == null ? '' : String(__raw);
    if (!__cf || !__cf.branches) return;
    var __next = -1;
    for (var __i = 0; __i < __cf.branches.length; __i++) {{
      var __b = __cf.branches[__i];
      if (!__b.cond) {{ __next = __i; break; }}
      try {{ if (__b.cond.call(this)) {{ __next = __i; break; }} }} catch {{}}
    }}
    if (__next === __activeBranch) return;
    __activeBranch = __next;
    var __br = __cf.branches[__next];
    var __nd = [].concat(__cf.stable || []).concat((__br && __br.deps) || []);
    __nd = Array.from(new Set(__nd));
    api.untrackPatch(this, __liveDeps, {patch_name}, {id_arg});
    __liveDeps = __nd;
    api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
  }}
  api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
}}).call(this);",
            cf = cf,
            deps_js = deps_js,
            body = body,
            el = el,
            patch_name = patch_name,
            id_arg = id_arg
        ));
    } else {
        stmts.push(format!(
            "api.trackPatch(this, [{deps_js}], function {patch_name}() {{ var __v; try {{ __v = {body}; }} catch {{ __v = null; }} {el}.innerHTML = __v == null ? '' : String(__v); }}, {id_arg});",
            deps_js = deps_js,
            body = body,
            el = el,
            patch_name = patch_name,
            id_arg = id_arg
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
    handler_ctx: ComponentHandlerCtx<'_>,
    ir: &mut IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
    child_ctors: &HashMap<String, String>,
) -> Result<String, String> {
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
    let (binding_id, dep_list) =
        binding_deps(ir, each.list_binding, &each.list_expr, fields, outer_scope);
    let list_root = dep_list
        .first()
        .map(|d| d.split('.').next().unwrap_or(d.as_str()).to_string())
        .unwrap_or_else(|| "list".into());
    let deps = deps_js(&dep_list);
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
    let item_fn = |ir: &mut IrDepCursor<'_>, next_id: &mut u32| -> Result<String, String> {
        let mut item_stmts = Vec::new();
        let item_root = emit_plain_element(
            tag,
            attrs,
            children,
            fields,
            &child_scope,
            &child_aliases,
            depth,
            handler_ctx,
            ir,
            &mut item_stmts,
            next_id,
            child_ctors,
        )?;
        Ok(format!(
            "function(api, {box_id}) {{\n{}  return {item_root};\n}}",
            indent_block(&item_stmts.join("\n"))
        ))
    };
    let (create_item, serialize_item_field) = if row_kernel.is_empty() {
        (item_fn(ir, next_id)?, String::new())
    } else {
        let serialize_fn = item_fn(ir, next_id)?;
        ("null".to_string(), format!("serializeItem: {serialize_fn}, "))
    };
    let row_tpl_helper = if row_kernel.is_empty() {
        String::new()
    } else {
        "  var rowTpl = null;\n  function rowTplNode() {\n    if (rowTpl) return rowTpl;\n    var wrap = document.createElement('template');\n    wrap.innerHTML = spec.rowKernel.html;\n    rowTpl = wrap.content.firstElementChild;\n    if (!rowTpl) throw new Error('vmz:rowKernel html produced no element');\n    return rowTpl;\n  }\n".to_string()
    };
    let apply_body = if row_kernel.is_empty() {
        r#"    var nextKeys = new Set();
    var i;
    for (i = 0; i < list.length; i++) nextKeys.add(keyOf(list[i], i));
    for (var k of keyed.keys()) {
      if (!nextKeys.has(k)) {
        var old = keyed.get(k);
        if (old) {
          var oldPatches = old.patches || [];
          for (var op = 0; op < oldPatches.length; op++) {
            var pfn = oldPatches[op];
            api.untrackPatch(inst, pfn.__vmzItemDeps || [], pfn, null);
          }
          if (old.dom && old.dom.parentNode) api.removeNode(old.dom);
        }
        keyed.delete(k);
      }
    }
    for (i = 0; i < list.length; i++) {
      var item = list[i];
      var key = keyOf(item, i);
      var entry = keyed.get(key);
      if (!entry) {
        var box = { item: item, index: i };
        var prevEach = api._eachCtx;
        var prevInst = api._inst;
        var itemPatches = [];
        api._eachCtx = {
          noteItemBind: function(bId, d, fn) { fn.__vmzItemDeps = d; },
          needDelegate: function() {}
        };
        api._inst = inst;
        api._itemPatches = itemPatches;
        var dom = spec.createItem.call(inst, api, box);
        api._eachCtx = prevEach;
        api._inst = prevInst;
        api._itemPatches = null;
        entry = { box: box, dom: dom, patches: itemPatches };
        keyed.set(key, entry);
        if (dom && end.parentNode) end.parentNode.insertBefore(dom, end);
        for (var p = 0; p < itemPatches.length; p++) {
          try { itemPatches[p].call(inst); } catch {}
        }
      } else {
        entry.box.item = item;
        entry.box.index = i;
        var patches = entry.patches || [];
        for (var p = 0; p < patches.length; p++) {
          try { patches[p].call(inst); } catch {}
        }
      }
    }"#
            .to_string()
    } else {
        r#"    var rk = spec.rowKernel;
    var ssrEach = spec.serializeItem && api.text && api.text('').__kind === 'text';
    var nextKeys = new Set();
    var i;
    for (i = 0; i < list.length; i++) nextKeys.add(keyOf(list[i], i));
    for (var k of keyed.keys()) {
      if (!nextKeys.has(k)) {
        var old = keyed.get(k);
        if (old) {
          var oldDom = ssrEach && old.dom ? old.dom : old;
          if (oldDom && oldDom.parentNode) api.removeNode(oldDom);
        }
        keyed.delete(k);
      }
    }
    if (ssrEach) {
      for (i = 0; i < list.length; i++) {
        var item = list[i];
        var key = keyOf(item, i);
        var entry = keyed.get(key);
        if (!entry) {
          var box = { item: item, index: i };
          var dom = spec.serializeItem.call(inst, api, box);
          if (dom && dom.__kind === 'el') {
            dom.__vmzKey = key;
            if (!dom.attrs) dom.attrs = Object.create(null);
            dom.attrs['data-vmz-key'] = String(key);
          }
          entry = { box: box, dom: dom, patches: [] };
          keyed.set(key, entry);
          if (dom && end.parentNode) end.parentNode.insertBefore(dom, end);
        } else {
          entry.box.item = item;
          entry.box.index = i;
        }
      }
      return;
    }
    var parent = end.parentNode;
    if (!parent) return;
    var firstNew = list.length;
    for (i = 0; i < list.length; i++) {
      var item = list[i];
      var key = keyOf(item, i);
      var root = keyed.get(key);
      if (root) {
        root.__vmzBox = item;
        rk.apply.call(inst, root, item);
      } else {
        firstNew = i;
        break;
      }
    }
    if (firstNew < list.length) {
      rk.create.call(inst, list, firstNew, rowTplNode(), keyed, parent, end, keyOf, null);
    }"#
            .to_string()
    };
    let row_kernel_hooks = if row_kernel.is_empty() {
        String::new()
    } else {
        format!(
            "  if (spec.rowKernel && spec.rowKernel.applyByField) {{\n    if (!inst.__vmzEachApplyLeaf) inst.__vmzEachApplyLeaf = Object.create(null);\n    inst.__vmzEachApplyLeaf[{list_root_q}] = function(idx, leaf, item) {{\n      var k = keyOf(item, idx);\n      var root = keyed.get(k);\n      if (!root) return false;\n      var fn = spec.rowKernel.applyByField[leaf];\n      if (typeof fn !== 'function') return false;\n      fn.call(inst, root, item);\n      return true;\n    }};\n    inst.__vmzDrainLeafDirty = function __vmzDrainLeafDirty() {{\n      var ld = inst.__vmzLeafDirty;\n      if (!ld || ld.root !== {list_root_q}) return;\n      var field = ld.field;\n      var fn = spec.rowKernel.applyByField[field];\n      if (typeof fn !== 'function') return;\n      var arr = inst[{list_root_q}];\n      for (var j = 0; j < ld.idxs.length; j++) {{\n        var ix = ld.idxs[j];\n        var it = arr && arr[ix];\n        if (!it) continue;\n        var k = keyOf(it, ix);\n        var root = keyed.get(k);\n        if (root) fn.call(inst, root, it);\n      }}\n      inst.__vmzLeafDirty = null;\n    }};\n  }}\n  if (spec.rowKernel && Array.isArray(spec.rowKernel.hostFields)) {{\n    for (var __hf = 0; __hf < spec.rowKernel.hostFields.length; __hf++) {{\n      (function(hostField) {{\n        api.trackPatch(inst, [hostField], function() {{\n          if (inst.__vmzDestroyed) return;\n          var list = readList();\n          var applyHost = spec.rowKernel.applyByField && spec.rowKernel.applyByField[hostField];\n          for (var i = 0; i < list.length; i++) {{\n            var item = list[i];\n            var key = keyOf(item, i);\n            var root = keyed.get(key);\n            if (!root) continue;\n            if (typeof applyHost === 'function') applyHost.call(inst, root, item);\n            else if (typeof spec.rowKernel.apply === 'function') spec.rowKernel.apply.call(inst, root, item);\n          }}\n        }}, null);\n      }})(spec.rowKernel.hostFields[__hf]);\n    }}\n  }}\n",
            list_root_q = q(&list_root),
        )
    };
    let v = fresh("k", next_id);
    let region_arg = each.region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
    stmts.push(format!(
        "var {v} = (function() {{
  var inst = this;
  var spec = {{ list: function() {{ return ({list_body}); }}, {key_field}{row_kernel}{serialize_item_field}createItem: {create_item} }};
  var start = api.comment('vmz-each:' + (spec.as || ''));
  var end = api.comment('/vmz-each');
  if ({region_arg} != null) start.__vmzRegion = {region_arg};
  var frag = api.frag();
  frag.appendChild(start);
  frag.appendChild(end);
  var keyed = new Map();
{row_kernel_hooks}  var keyScratch = {{ item: null, index: 0 }};
  function itemKey(box) {{
    if (typeof spec.key === 'function') {{
      try {{ return spec.key.call(inst, box); }} catch {{ return box.index; }}
    }}
    return box.index;
  }}
  function keyOf(item, index) {{
    keyScratch.item = item;
    keyScratch.index = index;
    return itemKey(keyScratch);
  }}
  function readList() {{
    var list = [];
    try {{ list = spec.list.call(inst) || []; }} catch {{ list = []; }}
    if (!Array.isArray(list)) list = Array.from(list);
    return list;
  }}
{row_tpl_helper}  function apply() {{
    if (inst.__vmzDestroyed) return;
    var list = readList();
{apply_body}
  }}
  api.trackPatch(inst, [{deps}], apply, {id_arg});
  apply();
  return frag;
}}).call(this);",
        row_tpl_helper = row_tpl_helper,
        apply_body = apply_body,
        row_kernel_hooks = row_kernel_hooks,
        v = v,
        list_body = list_body,
        key_field = key_field,
        row_kernel = row_kernel,
        serialize_item_field = serialize_item_field,
        create_item = create_item,
        region_arg = region_arg,
        deps = deps,
        id_arg = id_arg
    ));
    Ok(v)
}

fn emit_bind_text(
    expr: &str,
    binding: Option<BindingId>,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    _handler_ctx: ComponentHandlerCtx<'_>,
    ir: &IrDepCursor<'_>,
    stmts: &mut Vec<String>,
    next_id: &mut u32,
) -> Result<String, String> {
    let e = sanitize_interp(expr);
    let (binding_id, deps, cf_js) = bind_payload(&e, binding, fields, scope, aliases, ir);
    let v = fresh("t", next_id);
    stmts.push(format!("var {v} = api.text(\"\");"));
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if cf_js.is_none()
        && let Some(field) = single_field_binding_target(&e, fields, scope, aliases)
    {
        stmts.push(format!("api.specFieldText(this, {id_arg}, {}, {v});", q(&field)));
        return Ok(v);
    }
    let deps = deps_js(&deps);
    let body = bind_field_idents(&e, fields, scope, aliases);
    let patch_name =
        format!("__patchText{}", binding_id.map(|id| id.to_string()).unwrap_or_else(|| "X".into()));
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "(function() {{
  var __cf = {cf};
  var __liveDeps = [{deps}];
  var __activeBranch = -1;
  function {patch_name}() {{
    var __raw;
    try {{ __raw = {body}; }} catch {{ __raw = null; }}
    {v}.textContent = String(__raw != null ? __raw : '');
    if (!__cf || !__cf.branches) return;
    var __next = -1;
    for (var __i = 0; __i < __cf.branches.length; __i++) {{
      var __b = __cf.branches[__i];
      if (!__b.cond) {{ __next = __i; break; }}
      try {{ if (__b.cond.call(this)) {{ __next = __i; break; }} }} catch {{}}
    }}
    if (__next === __activeBranch) return;
    __activeBranch = __next;
    var __br = __cf.branches[__next];
    var __nd = [].concat(__cf.stable || []).concat((__br && __br.deps) || []);
    __nd = Array.from(new Set(__nd));
    api.untrackPatch(this, __liveDeps, {patch_name}, {id_arg});
    __liveDeps = __nd;
    api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
  }}
  api.trackPatch(this, __liveDeps, {patch_name}, {id_arg});
}}).call(this);",
            cf = cf,
            deps = deps,
            body = body,
            v = v,
            patch_name = patch_name,
            id_arg = id_arg
        ));
    } else {
        stmts.push(format!(
            "api.trackPatch(this, [{deps}], function {patch_name}() {{ var __v; try {{ __v = {body}; }} catch {{ __v = null; }} {text}.textContent = String(__v != null ? __v : ''); }}, {id_arg});",
            deps = deps,
            body = body,
            text = v,
            patch_name = patch_name,
            id_arg = id_arg
        ));
    }
    Ok(v)
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

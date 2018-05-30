//! Direct create/patch codegen from Native View (Native View / production Direct emit).
//!
//! Eligible Native View trees emit `__vmzCreate(api)` so mount/SSR/hydrate/resume
//! share one schedule. Structure comes from [`ViewView::roots`] only — not TemplateIr.
//! Coverage: element / text / attr / event / if / each / ternary / component / slot.
//! Production products do **not** emit blueprint `render` (production Direct emit full close).

use vmz_types::{BindingId, ViewAttr, ViewAttrValue, ViewEach, ViewNode, ViewStatus, ViewView};

use crate::emit::{
    bind_field_idents, collect_deps_oxc, is_event_attr, is_html_attr, looks_like_ternary,
    sanitize_interp, split_ternary_parts,
};
use crate::emit_ir::IrDepCursor;

/// True when the Native View can be compiled to `__vmzCreate`.
pub fn is_direct_eligible(view: &ViewView) -> bool {
    view.status == ViewStatus::Native && nodes_eligible(&view.roots)
}

fn nodes_eligible(nodes: &[ViewNode]) -> bool {
    nodes.iter().all(node_eligible)
}

fn node_eligible(node: &ViewNode) -> bool {
    match node {
        ViewNode::Text(_) | ViewNode::Interp { .. } => true,
        ViewNode::Element { attrs, children, .. } => {
            for a in attrs {
                if let ViewAttrValue::Interp(e) = &a.value {
                    if !is_event_attr(&a.name) {
                        let _ = e; // ternary attrs allowed (CF bind)
                    }
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
// SSR reuses the same create function with a serialize host API .
pub fn emit_direct_create(
    name: &str,
    view: &ViewView,
    fields: &[String],
    ir: &mut IrDepCursor<'_>,
) -> String {
    let mut next_id = 0u32;
    let body = emit_create_body(&view.roots, fields, &[], &[], 0, ir, &mut next_id);
    format!(
        "\n{name}.__vmzDirect = true;\n{name}.__vmzCreate = function __vmzCreate(api) {{\n{body}}};\n{name}.__vmzSerialize = {name}.__vmzCreate;\n",
    )
}

/// Emit `__vmzPlan` literal matching `units[].plan` in program.json (shared identity).
pub fn emit_vmz_plan(name: &str, plan: &vmz_types::ExecutionPlan) -> String {
    use vmz_protocol::PLAN_SCHEMA;
    let mut nodes = String::from("[");
    for (i, n) in plan.nodes.iter().enumerate() {
        if i > 0 {
            nodes.push(',');
        }
        let binding = n.binding.map(|b| b.to_string()).unwrap_or_else(|| "null".into());
        let region = n.region.map(|r| r.to_string()).unwrap_or_else(|| "null".into());
        let tag = match &n.tag {
            Some(t) => format!("{:?}", t),
            None => "null".into(),
        };
        let kids: Vec<String> = n.children.iter().map(|c| c.to_string()).collect();
        let brs: Vec<String> = n.branches.iter().map(|c| c.to_string()).collect();
        nodes.push_str(&format!(
            "{{id:{},kind:{:?},binding:{},region:{},tag:{},children:[{}],branches:[{}]}}",
            n.id,
            n.kind,
            binding,
            region,
            tag,
            kids.join(","),
            brs.join(",")
        ));
    }
    nodes.push(']');
    let roots: Vec<String> = plan.root_ids.iter().map(|id| id.to_string()).collect();
    format!(
        "\n{name}.__vmzPlan = {{ schema: {:?}, status: {:?}, root_ids: [{}], nodes: {nodes} }};\n",
        PLAN_SCHEMA,
        plan.status.as_str(),
        roots.join(", ")
    )
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
            stmts.insert(0, format!("var {frag} = api.frag();"));
            for r in &roots {
                stmts.push(format!("{frag}.appendChild({r});"));
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
        ViewNode::Text(t) => {
            let v = fresh("t", next_id);
            stmts.push(format!("var {v} = api.text({:?});", t));
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
            if let Some(n) = name {
                if !attrs.iter().any(|a| a.name == "name") {
                    attrs.insert(
                        0,
                        ViewAttr {
                            name: "name".into(),
                            value: ViewAttrValue::Static(n.clone()),
                            binding: None,
                        },
                    );
                }
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
    let deps_js = all_deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
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
        "var {v} = api.ifBlock(this, {id_arg}, [{deps_js}], [{}], {region_arg});",
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
    stmts.push(format!("var {el} = api.el({:?});", tag));
    for a in attrs {
        if a.name == "style:tw" {
            continue;
        }
        match &a.value {
            ViewAttrValue::Static(s) if is_html_attr(&a.name) => {
                stmts.push(format!("api.setHtml({el}, {:?});", s));
            }
            ViewAttrValue::Static(s) => {
                if a.name == "className" {
                    stmts.push(format!("api.attr({el}, \"class\", {:?});", s));
                } else {
                    stmts.push(format!("api.attr({el}, {:?}, {:?});", a.name, s));
                }
            }
            ViewAttrValue::Bare => {}
            ViewAttrValue::Interp(e) if is_event_attr(&a.name) => {
                let body = bind_field_idents(e, fields, scope, aliases);
                let type_name = a.name[2..].to_ascii_lowercase();
                stmts.push(format!("api.on({el}, {:?}, {body});", type_name));
            }
            ViewAttrValue::Interp(e) if is_html_attr(&a.name) => {
                emit_bind_html(e, a.binding, &el, fields, scope, aliases, ir, stmts);
            }
            ViewAttrValue::Interp(e) => {
                emit_bind_attr(e, a.binding, &a.name, &el, fields, scope, aliases, ir, stmts);
            }
        }
    }
    for child in emit_nodes(children, fields, scope, aliases, each_depth, ir, stmts, next_id) {
        stmts.push(format!("{el}.appendChild({child});"));
    }
    el
}

fn emit_component(
    tag: &str,
    attrs: &[ViewAttr],
    _children: &[ViewNode],
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    _each_depth: u32,
    _ir: &mut IrDepCursor<'_>,
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
            ViewAttrValue::Static(s) => format!("{:?}", s),
            ViewAttrValue::Bare => "true".to_string(),
            ViewAttrValue::Interp(e) if is_event_attr(&a.name) => {
                bind_field_idents(e, fields, scope, aliases)
            }
            ViewAttrValue::Interp(e) => {
                let rewritten = bind_field_idents(e, fields, scope, aliases);
                if !aliases.is_empty() {
                    rewritten
                } else {
                    let root = e.split('.').next().unwrap_or("");
                    if !root.is_empty() && fields.iter().any(|f| f == root) {
                        format!("this.{e}")
                    } else {
                        e.clone()
                    }
                }
            }
        };
        prop_parts.push(format!("{:?}:{}", a.name, val));
    }
    let props = format!("{{{}}}", prop_parts.join(","));
    let client_arg = match &client {
        Some(c) => format!("{:?}", c),
        None => "null".into(),
    };
    let v = fresh("c", next_id);
    stmts.push(format!("var {v} = api.component(this, {:?}, {props}, {client_arg});", tag));
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
    let deps_js = deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
    let body = bind_field_idents(&e, fields, scope, aliases);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindAttr(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {el}, {:?}, {cf});",
            name
        ));
    } else {
        stmts.push(format!(
            "api.bindAttr(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {el}, {:?});",
            name
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
    let deps_js = deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
    let body = bind_field_idents(&e, fields, scope, aliases);
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindHtml(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {el}, {cf});"
        ));
    } else {
        stmts.push(format!(
            "api.bindHtml(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {el});"
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
    let deps_js = deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    let list_body = bind_field_idents(&each.list_expr, fields, outer_scope, outer_aliases);

    let key_field = if let Some(k) = &each.key_expr {
        let kbody = bind_field_idents(k, fields, &child_scope, &child_aliases);
        format!("key: function({box_id}) {{ return ({kbody}); }}, ")
    } else {
        String::new()
    };

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
    let create_item = format!(
        "function(api, {box_id}) {{\n{}  return {item_root};\n}}",
        indent_block(&item_stmts.join("\n"))
    );

    let v = fresh("k", next_id);
    let region_arg = each.region.map(|r| r.0.to_string()).unwrap_or_else(|| "null".into());
    stmts.push(format!(
        "var {v} = api.eachBlock(this, {id_arg}, [{deps_js}], {{ list: function() {{ return ({list_body}); }}, {key_field}createItem: {create_item} }}, {region_arg});"
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
    let deps_js = deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
    let body = bind_field_idents(&e, fields, scope, aliases);
    let v = fresh("t", next_id);
    stmts.push(format!("var {v} = api.text(\"\");"));
    let id_arg = binding_id.map(|id| id.to_string()).unwrap_or_else(|| "null".into());
    if let Some(cf) = cf_js {
        stmts.push(format!(
            "api.bindText(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {v}, {cf});"
        ));
    } else {
        stmts.push(format!(
            "api.bindText(this, {id_arg}, [{deps_js}], function() {{ return {body}; }}, {v});"
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
    if looks_like_ternary(expr) {
        if let Some(bid) = binding {
            if let Some(cf) = ir.control_flow_for_binding(bid.0) {
                if let Some((test_src, _, _)) = split_ternary_parts(expr) {
                    let stable = cf
                        .branches
                        .first()
                        .map(|b| b.cond_deps.clone())
                        .unwrap_or_else(|| cf.stable.clone());
                    let cons_deps =
                        cf.branches.first().map(|b| b.body_deps.clone()).unwrap_or_default();
                    let alt_deps =
                        cf.branches.get(1).map(|b| b.body_deps.clone()).unwrap_or_default();
                    let mut deps_all = cf.stable.clone();
                    for d in stable.iter().chain(cons_deps.iter()).chain(alt_deps.iter()) {
                        if !deps_all.iter().any(|x| x == d) {
                            deps_all.push(d.clone());
                        }
                    }
                    let stable_js =
                        stable.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
                    let cons_js =
                        cons_deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
                    let alt_js =
                        alt_deps.iter().map(|d| format!("{:?}", d)).collect::<Vec<_>>().join(", ");
                    let test_body = bind_field_idents(&test_src, fields, scope, aliases);
                    let cf_js = format!(
                        "{{ stable: [{stable_js}], branches: [{{ cond: function() {{ return ({test_body}); }}, deps: [{cons_js}] }},{{ deps: [{alt_js}] }}] }}"
                    );
                    return (Some(bid.0), deps_all, Some(cf_js));
                }
            }
        }
    }
    let (id, deps) = binding_deps(ir, binding, expr, fields, scope);
    (id, deps, None)
}

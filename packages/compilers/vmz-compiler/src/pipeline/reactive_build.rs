//! Build [`ReactiveModule`] / [`ProgramModule`] from analyzed component + template IR.
//!
//! Reactive is one Program IR view.
//! Static property paths + if/each regions + method effects.
//! 8.9: keyed `each` item props ?[`IrDepPath::ListItem`] when list root is a field.

use vmz_types::{
    BindingId, BindingKind, ComponentDecl, ControlBranch, FieldId, FieldKind, IrDepPath,
    ListItemFrame, ProgramModule, REACTIVE_SCHEMA, ReactiveComponentBuilder, ReactiveModule,
    RegionId, WritePath,
};

use crate::field_rw::{collect_each_alias_prop_paths, collect_template_dep_keys};
use crate::template::{
    AttrValue, ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg, SemanticIr,
    SemanticNode, SemanticProp, TemplateAttr, TemplateIr, TemplateNode, TemplateSpan,
};
use vmz_generator::js::is_event_attr;
use vmz_generator::template_expr_snippet_error;

/// One invalid template expression finding (body-local span for absolute conversion).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateExprError {
    /// Human message (`invalid template expression …`).
    pub message: String,
    /// UTF-8 `[start,end)` into the `<template>` body (not the SFC file).
    pub body_span: TemplateSpan,
}

/// Collect oxc parse failures for every template expression binding (interp / attr).
///
/// Expressions remain `String` in IR; this is the early validation ingress before
/// emit re-parses for codegen. Prefer [`collect_concrete_expr_errors`] when spans matter.
pub fn collect_template_expr_errors(template: &TemplateIr) -> Vec<String> {
    collect_concrete_expr_errors_from_ir(template).into_iter().map(|e| e.message).collect()
}

/// Walk Concrete AST and return expression errors with body-local spans.
pub fn collect_concrete_expr_errors(concrete: &ConcreteIr) -> Vec<TemplateExprError> {
    let mut out = Vec::new();
    walk_concrete_expr_errors(&concrete.roots, &mut out);
    out
}

fn collect_concrete_expr_errors_from_ir(template: &TemplateIr) -> Vec<TemplateExprError> {
    let mut out = Vec::new();
    walk_ir_expr_errors(&template.roots, &mut out);
    out
}

fn walk_ir_expr_errors(nodes: &[TemplateNode], out: &mut Vec<TemplateExprError>) {
    for n in nodes {
        match n {
            TemplateNode::Interp(e) => push_expr_error_ir(e, out),
            TemplateNode::Text(_) => {}
            TemplateNode::Element { attrs, children, .. } => {
                for a in attrs {
                    match &a.value {
                        AttrValue::Interp(e) => push_expr_error_ir(e, out),
                        AttrValue::Static(_) => {}
                    }
                }
                walk_ir_expr_errors(children, out);
            }
        }
    }
}

fn push_expr_error_ir(expr: &str, out: &mut Vec<TemplateExprError>) {
    if let Some(msg) = template_expr_snippet_error(expr) {
        out.push(TemplateExprError {
            message: format!("invalid template expression `{expr}`: {msg}"),
            // Legacy IR has no spans; callers that need offsets must use Concrete.
            body_span: TemplateSpan { start: 0, end: 0 },
        });
    }
}

fn walk_concrete_expr_errors(nodes: &[ConcreteNode], out: &mut Vec<TemplateExprError>) {
    for n in nodes {
        match n {
            ConcreteNode::Interpolation { expr, span, .. } => {
                push_expr_error(expr, *span, out);
            }
            ConcreteNode::Text { .. } | ConcreteNode::Comment { .. } => {}
            ConcreteNode::Element { attrs, children, .. } => {
                for a in attrs {
                    match a {
                        ConcreteAttr::Static { .. } => {}
                        ConcreteAttr::Directive { dir, span } => {
                            for expr in directive_exprs(dir) {
                                push_expr_error(expr, *span, out);
                            }
                        }
                    }
                }
                walk_concrete_expr_errors(children, out);
            }
        }
    }
}

fn directive_exprs(dir: &Directive) -> Vec<&str> {
    match dir {
        Directive::If { test } | Directive::ElseIf { test } => vec![test.as_str()],
        Directive::Else => vec![],
        Directive::For { source, .. } => vec![source.as_str()],
        Directive::Bind { expr, .. } | Directive::BindObject { expr } => vec![expr.as_str()],
        Directive::On { handler, .. } => vec![handler.as_str()],
        Directive::OnObject { expr } => vec![expr.as_str()],
        Directive::Html { expr } | Directive::Show { expr } | Directive::Model { expr, .. } => {
            vec![expr.as_str()]
        }
        Directive::Slot { props, .. } => props.as_deref().into_iter().collect(),
        Directive::Custom { expr, .. } => expr.as_deref().into_iter().collect(),
    }
}

fn push_expr_error(expr: &str, body_span: TemplateSpan, out: &mut Vec<TemplateExprError>) {
    if let Some(msg) = template_expr_snippet_error(expr) {
        out.push(TemplateExprError {
            message: format!("invalid template expression `{expr}`: {msg}"),
            body_span,
        });
    }
}

/// Active keyed `each` frame for ListItem path construction (supports nested each).
#[derive(Debug, Clone)]
struct EachFrame {
    list: FieldId,
    /// Outermost → this frame (inclusive).
    frames: Vec<ListItemFrame>,
    as_name: String,
}

/// Build a [`ReactiveModule`] from component decl + **Semantic** template AST.
///
/// `IfChain` / `ForNode` drive control regions — no sibling flat-attr guessing.
pub fn build_reactive_module_from_semantic(
    source: &str,
    decl: &ComponentDecl,
    semantic: &SemanticIr,
) -> ReactiveModule {
    let mut b = ReactiveComponentBuilder::new(decl.name.clone());
    for f in &decl.properties {
        b.add_field(f.name.clone(), FieldKind::Prop);
    }
    for f in &decl.fields {
        b.add_field(f.name.clone(), FieldKind::State);
    }

    let fields: Vec<String> =
        decl.properties.iter().chain(decl.fields.iter()).map(|f| f.name.clone()).collect();

    walk_semantic_nodes(&semantic.roots, &fields, &[], &[], &mut b, None);
    finish_effects(&mut b, decl, &fields);

    ReactiveModule {
        schema: REACTIVE_SCHEMA.into(),
        source: source.to_string(),
        components: vec![b.finish()],
    }
}

/// Build a [`ReactiveModule`] from component decl + legacy [`TemplateIr`].
///
/// Prefer [`build_reactive_module_from_semantic`] for if/for correctness.
pub fn build_reactive_module(
    source: &str,
    decl: &ComponentDecl,
    template: &TemplateIr,
) -> ReactiveModule {
    let mut b = ReactiveComponentBuilder::new(decl.name.clone());
    for f in &decl.properties {
        b.add_field(f.name.clone(), FieldKind::Prop);
    }
    for f in &decl.fields {
        b.add_field(f.name.clone(), FieldKind::State);
    }

    let fields: Vec<String> =
        decl.properties.iter().chain(decl.fields.iter()).map(|f| f.name.clone()).collect();

    walk_nodes(&template.roots, &fields, &[], &[], &mut b, None);
    finish_effects(&mut b, decl, &fields);

    ReactiveModule {
        schema: REACTIVE_SCHEMA.into(),
        source: source.to_string(),
        components: vec![b.finish()],
    }
}

fn finish_effects(b: &mut ReactiveComponentBuilder, decl: &ComponentDecl, fields: &[String]) {
    let mut methods = decl.methods.clone();
    crate::method_compose::compose_cross_method_rw(&mut methods, fields);
    for m in &methods {
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        let reads: Vec<IrDepPath> = m.reads.iter().filter_map(|s| stable_to_ir(b, s)).collect();
        let writes: Vec<WritePath> = m
            .writes
            .iter()
            .filter_map(|s| stable_to_ir(b, s).map(|path| WritePath { path }))
            .collect();
        b.add_effect(
            m.name.clone(),
            reads,
            writes,
            m.is_async,
            m.calls.clone(),
            m.opaque_callee,
            m.star_reasons.clone(),
        );
    }
}

/// Build the Program IR shell with Reactive as the populated view (legacy TemplateIr reactive).
pub fn build_program_module(
    source: &str,
    decl: &ComponentDecl,
    template: &TemplateIr,
) -> ProgramModule {
    build_program_module_with_server(source, decl, template, None, None)
}

/// Build Program IR from Semantic (reactive) + legacy TemplateIr (native view).
pub fn build_program_module_asts(
    source: &str,
    decl: &ComponentDecl,
    semantic: &SemanticIr,
    template: &TemplateIr,
) -> ProgramModule {
    build_program_module_with_server_asts(source, decl, semantic, template, None, None)
}

/// Build Program IR and attach co-located server capabilities when present.
pub fn build_program_module_with_server(
    source: &str,
    decl: &ComponentDecl,
    template: &TemplateIr,
    server: Option<&vmz_types::ServerAttach>,
    routes: Option<&crate::pipeline::link::RouteTable>,
) -> ProgramModule {
    let mut program = ProgramModule::from_reactive(build_reactive_module(source, decl, template));
    attach_view_plan(&mut program, template, server, routes);
    program
}

/// Preferred program path: Semantic drives reactive regions; TemplateIr still feeds view emit.
pub fn build_program_module_with_server_asts(
    source: &str,
    decl: &ComponentDecl,
    semantic: &SemanticIr,
    template: &TemplateIr,
    server: Option<&vmz_types::ServerAttach>,
    routes: Option<&crate::pipeline::link::RouteTable>,
) -> ProgramModule {
    let mut program =
        ProgramModule::from_reactive(build_reactive_module_from_semantic(source, decl, semantic));
    attach_view_plan(&mut program, template, server, routes);
    program
}

fn attach_view_plan(
    program: &mut ProgramModule,
    template: &TemplateIr,
    server: Option<&vmz_types::ServerAttach>,
    routes: Option<&crate::pipeline::link::RouteTable>,
) {
    if let Some(unit) = program.units.first_mut() {
        if let Some(attach) = server {
            unit.attach_server(attach);
        }
        unit.view = crate::structural_build::build_native_view(template, &unit.reactive, routes);
        unit.plan = crate::plan_build::build_execution_plan(&unit.view);
        unit.rebuild_projected_views();
    }
}

fn walk_semantic_nodes(
    nodes: &[SemanticNode],
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    for node in nodes {
        match node {
            SemanticNode::Text { .. } => {}
            SemanticNode::Interpolation { expr, .. } => {
                add_text_binding(expr, fields, scope, each_frames, b, region);
            }
            SemanticNode::IfChain { branches, .. } => {
                walk_semantic_if_chain(branches, fields, scope, each_frames, b);
            }
            SemanticNode::ForNode { .. } => {
                walk_semantic_for(node, fields, scope, each_frames, b, region);
            }
            SemanticNode::Element { .. } => {
                walk_semantic_element(node, fields, scope, each_frames, b, region);
            }
            SemanticNode::SlotOutlet { children, props, .. } => {
                for p in props {
                    walk_semantic_prop_bindings(p, "slot", fields, scope, each_frames, b, region);
                }
                walk_semantic_nodes(children, fields, scope, each_frames, b, region);
            }
            SemanticNode::SlotTemplate { body, slot_props, .. } => {
                if let Some(sp) = slot_props {
                    // Slot props alias is a binding source for the filler body scope later;
                    // still walk the body under the current scope for this peel.
                    let _ = sp;
                }
                walk_semantic_nodes(
                    std::slice::from_ref(body.as_ref()),
                    fields,
                    scope,
                    each_frames,
                    b,
                    region,
                );
            }
        }
    }
}

fn walk_semantic_if_chain(
    branches: &[crate::template::IfBranch],
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
) {
    let mut stable: Vec<IrDepPath> = Vec::new();
    let mut control_branches: Vec<ControlBranch> = Vec::new();
    let mut body_binding_lists: Vec<Vec<BindingId>> = Vec::new();
    let mut first_cond: Option<String> = None;

    for branch in branches {
        let mut cond_reads = Vec::new();
        let cond_expr = if let Some(c) = &branch.test {
            let e = sanitize(c);
            if first_cond.is_none() {
                first_cond = Some(e.clone());
            }
            cond_reads = expr_to_paths(b, &e, fields, scope, each_frames);
            for r in &cond_reads {
                push_unique_path(&mut stable, r.clone());
            }
            Some(b.intern_expr(e))
        } else {
            None
        };

        let before = b.binding_count();
        walk_semantic_nodes(
            std::slice::from_ref(branch.body.as_ref()),
            fields,
            scope,
            each_frames,
            b,
            None,
        );
        let after = b.binding_count();
        let body_bindings: Vec<BindingId> = (before..after).map(BindingId).collect();
        body_binding_lists.push(body_bindings.clone());
        control_branches.push(ControlBranch {
            cond: cond_expr,
            cond_reads,
            body_bindings,
            body_reads: Vec::new(),
        });
    }

    let region_id = b.add_control_region(stable.clone(), control_branches);
    if let Some(first) = first_cond {
        let cond_expr = b.intern_expr(first);
        b.add_binding(BindingKind::IfCond, stable, Some(region_id), Some(cond_expr), None);
    }
    for ids in &body_binding_lists {
        for id in ids {
            if b.binding_kind(*id)
                .is_some_and(|k| matches!(k, BindingKind::EachList | BindingKind::EachKey))
            {
                continue;
            }
            if b.binding_region(*id).is_some() {
                continue;
            }
            b.set_binding_region(*id, region_id);
        }
    }
}

fn walk_semantic_for(
    node: &SemanticNode,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    let SemanticNode::ForNode { source, value_alias, key_alias, index_alias, key, body, .. } = node
    else {
        return;
    };

    let e = sanitize(source);
    let list_reads = expr_to_paths(b, &e, fields, scope, each_frames);
    let list_expr_id = b.intern_expr(e);
    let each_region = b.add_control_region(list_reads.clone(), Vec::new());
    b.add_binding(
        BindingKind::EachList,
        list_reads.clone(),
        Some(each_region),
        Some(list_expr_id),
        None,
    );

    let mut s = scope.to_vec();
    if !value_alias.is_empty() && !s.iter().any(|x| x == value_alias) {
        s.push(value_alias.clone());
    }
    if let Some(ka) = key_alias {
        if !ka.is_empty() && !s.iter().any(|x| x == ka) {
            s.push(ka.clone());
        }
    }
    if let Some(ia) = index_alias {
        if !ia.is_empty() && !s.iter().any(|x| x == ia) {
            s.push(ia.clone());
        }
    }
    if !s.iter().any(|x| x == "index") {
        s.push("index".into());
    }

    let key_id = key.as_ref().map(|k| b.intern_expr(sanitize(k)));
    let list_nest = nest_from_list_reads(&list_reads);
    let mut frames = each_frames.to_vec();
    if let Some((list, parent_frames, via)) = list_nest {
        if !value_alias.is_empty() {
            let mut item_frames = parent_frames;
            item_frames.push(ListItemFrame { via, key: key_id });
            frames.push(EachFrame { list, frames: item_frames, as_name: value_alias.clone() });
        }
    }

    if let Some(key_expr) = key {
        let ke = sanitize(key_expr);
        let key_reads = expr_to_paths(b, &ke, fields, &s, &frames);
        let kid = key_id.expect("key_id set when key present");
        b.add_binding(BindingKind::EachKey, key_reads, Some(each_region), Some(kid), None);
    }

    let child_region = Some(each_region).or(region);
    walk_semantic_nodes(std::slice::from_ref(body.as_ref()), fields, &s, &frames, b, child_region);
}

fn walk_semantic_element(
    node: &SemanticNode,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    let SemanticNode::Element { tag, props, children, .. } = node else {
        return;
    };

    for p in props {
        walk_semantic_prop_bindings(p, tag, fields, scope, each_frames, b, region);
    }

    walk_semantic_nodes(children, fields, scope, each_frames, b, region);
}

fn walk_semantic_prop_bindings(
    p: &SemanticProp,
    tag: &str,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    match p {
        SemanticProp::Static { .. } => {}
        SemanticProp::Bind { arg, expr, .. } => {
            let name = match arg {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            let kind =
                if is_component_tag(tag) { BindingKind::ComponentProp } else { BindingKind::Attr };
            add_expr_binding(expr, kind, Some(name), fields, scope, each_frames, b, region);
        }
        SemanticProp::BindObject { expr, .. } => {
            add_expr_binding(
                expr,
                BindingKind::Attr,
                Some("v-bind".into()),
                fields,
                scope,
                each_frames,
                b,
                region,
            );
        }
        SemanticProp::On { arg, handler, .. } => {
            let event = match arg {
                DirectiveArg::Static(s) => s.clone(),
                DirectiveArg::Dynamic(e) => format!("[{e}]"),
            };
            let body = sanitize(handler);
            let reads = expr_to_paths(b, &body, fields, scope, each_frames);
            let expr = b.intern_expr(body);
            b.add_binding(BindingKind::Event, reads, region, Some(expr), Some(format!("@{event}")));
        }
        SemanticProp::OnObject { expr, .. } => {
            let body = sanitize(expr);
            let reads = expr_to_paths(b, &body, fields, scope, each_frames);
            let eid = b.intern_expr(body);
            b.add_binding(BindingKind::Event, reads, region, Some(eid), Some("v-on".into()));
        }
        SemanticProp::Model { arg, expr, .. } => {
            let prop = arg.clone().unwrap_or_else(|| "modelValue".into());
            add_expr_binding(
                expr,
                if is_component_tag(tag) { BindingKind::ComponentProp } else { BindingKind::Attr },
                Some(prop.clone()),
                fields,
                scope,
                each_frames,
                b,
                region,
            );
            let update = format!("$event => (({expr}) = $event)");
            let body = sanitize(&update);
            let reads = expr_to_paths(b, &body, fields, scope, each_frames);
            let eid = b.intern_expr(body);
            b.add_binding(
                BindingKind::Event,
                reads,
                region,
                Some(eid),
                Some(format!("@update:{prop}")),
            );
        }
        SemanticProp::ClassPlan { binds, .. } => {
            for expr in binds {
                add_expr_binding(
                    expr,
                    BindingKind::Attr,
                    Some("class".into()),
                    fields,
                    scope,
                    each_frames,
                    b,
                    region,
                );
            }
        }
        SemanticProp::StylePlan { binds, .. } => {
            for expr in binds {
                add_expr_binding(
                    expr,
                    BindingKind::Attr,
                    Some("style".into()),
                    fields,
                    scope,
                    each_frames,
                    b,
                    region,
                );
            }
        }
        SemanticProp::Directive { dir, .. } => match dir {
            Directive::Html { expr } | Directive::Show { expr } => {
                let name = if matches!(dir, Directive::Html { .. }) { "html" } else { "show" };
                add_expr_binding(
                    expr,
                    BindingKind::Attr,
                    Some(name.into()),
                    fields,
                    scope,
                    each_frames,
                    b,
                    region,
                );
            }
            _ => {}
        },
    }
}

fn walk_nodes(
    nodes: &[TemplateNode],
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    let mut i = 0;
    while i < nodes.len() {
        if matches!(&nodes[i], TemplateNode::Text(t) if t.trim().is_empty()) {
            i += 1;
            continue;
        }

        if let TemplateNode::Element { attrs, .. } = &nodes[i] {
            if let Some(cond) = attr_interp(attrs, "if") {
                let mut branch_specs: Vec<(Option<String>, usize)> = Vec::new();
                branch_specs.push((Some(cond), i));
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
                        branch_specs.push((Some(elseif_cond), j));
                        j += 1;
                        continue;
                    }
                    if has_bare_attr(a2, "else") {
                        branch_specs.push((None, j));
                        j += 1;
                    }
                    break;
                }

                let mut stable: Vec<IrDepPath> = Vec::new();
                let mut branches: Vec<ControlBranch> = Vec::new();
                let mut body_binding_lists: Vec<Vec<BindingId>> = Vec::new();

                for (cond_opt, idx) in &branch_specs {
                    let mut cond_reads = Vec::new();
                    let cond_expr = if let Some(c) = cond_opt {
                        let e = sanitize(c);
                        cond_reads = expr_to_paths(b, &e, fields, scope, each_frames);
                        for r in &cond_reads {
                            push_unique_path(&mut stable, r.clone());
                        }
                        Some(b.intern_expr(e))
                    } else {
                        None
                    };

                    let before = b.binding_count();
                    walk_element_branch(&nodes[*idx], fields, scope, each_frames, b);
                    let after = b.binding_count();
                    let body_bindings: Vec<BindingId> = (before..after).map(BindingId).collect();
                    body_binding_lists.push(body_bindings.clone());
                    branches.push(ControlBranch {
                        cond: cond_expr,
                        cond_reads,
                        body_bindings,
                        body_reads: Vec::new(),
                    });
                }

                let region_id = b.add_control_region(stable.clone(), branches);
                // IfCond binding: structural switch keyed by stable cond deps (BindingId hot path).
                if let Some(first_cond) =
                    branch_specs.iter().find_map(|(c, _)| c.as_ref()).map(|c| sanitize(c))
                {
                    let cond_expr = b.intern_expr(first_cond);
                    b.add_binding(
                        BindingKind::IfCond,
                        stable,
                        Some(region_id),
                        Some(cond_expr),
                        None,
                    );
                }
                for ids in &body_binding_lists {
                    for id in ids {
                        // Keep EachList/EachKey LifetimeRegion; do not collapse into parent if.
                        if b.binding_kind(*id).is_some_and(|k| {
                            matches!(k, BindingKind::EachList | BindingKind::EachKey)
                        }) {
                            continue;
                        }
                        if b.binding_region(*id).is_some() {
                            continue;
                        }
                        b.set_binding_region(*id, region_id);
                    }
                }

                i = j;
                continue;
            }
        }

        walk_node(&nodes[i], fields, scope, each_frames, b, region);
        i += 1;
    }
}

fn walk_node(
    node: &TemplateNode,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    match node {
        TemplateNode::Text(_) => {}
        TemplateNode::Interp(expr) => {
            add_text_binding(expr, fields, scope, each_frames, b, region);
        }
        TemplateNode::Element { .. } => {
            walk_element_stripping(node, fields, scope, each_frames, b, region, &[], true);
        }
    }
}

fn walk_element_branch(
    node: &TemplateNode,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
) {
    let TemplateNode::Element { attrs, .. } = node else {
        return;
    };
    let strip_name = if attrs.iter().any(|a| a.name == "if") {
        "if"
    } else if attrs.iter().any(|a| a.name == "else-if") {
        "else-if"
    } else {
        "else"
    };
    walk_element_stripping(node, fields, scope, each_frames, b, None, &[strip_name], true);
}

#[allow(clippy::too_many_arguments)]
fn walk_element_stripping(
    node: &TemplateNode,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
    strip: &[&str],
    allow_each: bool,
) {
    let TemplateNode::Element { tag, attrs, children } = node else {
        return;
    };

    let each_expr = if allow_each { attr_interp(attrs, "each") } else { None };
    let each_as = if allow_each { attr_static(attrs, "as") } else { None };
    let each_key = if allow_each { attr_interp(attrs, "key") } else { None };

    let filtered: Vec<&TemplateAttr> = attrs
        .iter()
        .filter(|a| {
            if strip.iter().any(|s| *s == a.name) {
                return false;
            }
            if allow_each && matches!(a.name.as_str(), "each" | "as" | "key") {
                return false;
            }
            true
        })
        .collect();

    let mut each_lifetime: Option<RegionId> = None;
    let (child_scope, child_frames) =
        if let (Some(list_expr), Some(as_name)) = (each_expr.as_ref(), each_as.as_ref()) {
            let e = sanitize(list_expr);
            let list_reads = expr_to_paths(b, &e, fields, scope, each_frames);
            let list_expr_id = b.intern_expr(e);
            // each owns its LifetimeRegion (not just parent CF region).
            let each_region = b.add_control_region(list_reads.clone(), Vec::new());
            each_lifetime = Some(each_region);
            b.add_binding(
                BindingKind::EachList,
                list_reads.clone(),
                Some(each_region),
                Some(list_expr_id),
                None,
            );

            let mut s = scope.to_vec();
            if !as_name.is_empty() && !s.iter().any(|x| x == as_name) {
                s.push(as_name.clone());
            }
            if !s.iter().any(|x| x == "index") {
                s.push("index".into());
            }

            let list_nest = nest_from_list_reads(&list_reads);
            let key_id = each_key.as_ref().map(|k| b.intern_expr(sanitize(k)));

            let mut frames = each_frames.to_vec();
            if let Some((list, parent_frames, via)) = list_nest {
                if !as_name.is_empty() {
                    let mut item_frames = parent_frames;
                    item_frames.push(ListItemFrame { via, key: key_id });
                    frames.push(EachFrame { list, frames: item_frames, as_name: as_name.clone() });
                }
            }

            if let Some(key_expr) = &each_key {
                let ke = sanitize(key_expr);
                let key_reads = expr_to_paths(b, &ke, fields, &s, &frames);
                let kid = key_id.expect("key_id set when each_key present");
                b.add_binding(BindingKind::EachKey, key_reads, Some(each_region), Some(kid), None);
            }

            (s, frames)
        } else {
            (scope.to_vec(), each_frames.to_vec())
        };

    let child_region = each_lifetime.or(region);

    for a in &filtered {
        match &a.value {
            AttrValue::Static(_) => {}
            AttrValue::Interp(e) if is_event_attr(&a.name) => {
                let body = sanitize(e);
                let reads = expr_to_paths(b, &body, fields, &child_scope, &child_frames);
                let expr = b.intern_expr(body);
                b.add_binding(
                    BindingKind::Event,
                    reads,
                    child_region,
                    Some(expr),
                    Some(a.name.clone()),
                );
            }
            AttrValue::Interp(e) => {
                let kind = if is_component_tag(tag) {
                    BindingKind::ComponentProp
                } else {
                    BindingKind::Attr
                };
                add_expr_binding(
                    e,
                    kind,
                    Some(a.name.clone()),
                    fields,
                    &child_scope,
                    &child_frames,
                    b,
                    child_region,
                );
            }
        }
    }

    walk_nodes(children, fields, &child_scope, &child_frames, b, child_region);
}

fn add_text_binding(
    expr: &str,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    add_expr_binding(expr, BindingKind::Text, None, fields, scope, each_frames, b, region);
}

#[allow(clippy::too_many_arguments)]
fn add_expr_binding(
    expr: &str,
    kind: BindingKind,
    attr: Option<String>,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
    b: &mut ReactiveComponentBuilder,
    region: Option<RegionId>,
) {
    let e = sanitize(expr);
    if let Some((test, cons, alt)) = split_ternary(&e) {
        let stable = expr_to_paths(b, &test, fields, scope, each_frames);
        let cons_reads = expr_to_paths(b, &cons, fields, scope, each_frames);
        let alt_reads = expr_to_paths(b, &alt, fields, scope, each_frames);
        let mut all = stable.clone();
        for r in cons_reads.iter().chain(alt_reads.iter()) {
            push_unique_path(&mut all, r.clone());
        }
        let test_id = b.intern_expr(test);
        let region_id = b.add_control_region(
            stable.clone(),
            vec![
                ControlBranch {
                    cond: Some(test_id),
                    cond_reads: stable,
                    body_bindings: Vec::new(),
                    body_reads: cons_reads,
                },
                ControlBranch {
                    cond: None,
                    cond_reads: Vec::new(),
                    body_bindings: Vec::new(),
                    body_reads: alt_reads,
                },
            ],
        );
        let expr_id = b.intern_expr(e);
        b.add_binding(kind, all, Some(region_id), Some(expr_id), attr);
        return;
    }
    let reads = expr_to_paths(b, &e, fields, scope, each_frames);
    let expr_id = b.intern_expr(e);
    b.add_binding(kind, reads, region, Some(expr_id), attr);
}

/// Split top-level `a ? b : c` into (test, consequent, alternate).
fn split_ternary(expr: &str) -> Option<(String, String, String)> {
    use oxc_span::GetSpan;

    let src = vmz_generator::js::wrap_template_expr_source(expr);
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() || ret.panicked {
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
        if s < e && e <= src.len() { Some(src[s..e].trim().to_string()) } else { None }
    };
    let test = slice(cond.test.span())?;
    let cons = slice(cond.consequent.span())?;
    let alt = slice(cond.alternate.span())?;
    if test.is_empty() || cons.is_empty() || alt.is_empty() {
        return None;
    }
    Some((test, cons, alt))
}

/// Field deps + keyed each-alias props as [`IrDepPath::ListItem`] (flat or nested).
fn expr_to_paths(
    b: &mut ReactiveComponentBuilder,
    expr: &str,
    fields: &[String],
    scope: &[String],
    each_frames: &[EachFrame],
) -> Vec<IrDepPath> {
    let mut out = keys_to_paths(b, &collect_template_dep_keys(expr, fields, scope));
    for frame in each_frames {
        for prop_segs in collect_each_alias_prop_paths(expr, &frame.as_name) {
            let path: Vec<_> = prop_segs.iter().map(|p| b.intern_prop(p.clone())).collect();
            push_unique_path(
                &mut out,
                IrDepPath::ListItem { list: frame.list, frames: frame.frames.clone(), path },
            );
        }
    }
    out
}

/// Resolve `each={…}` list expression to a nestable list root.
///
/// - `each={tags}` → `(tags, [], [])`
/// - `each={g.items}` inside outer groups → `(groups, [outer_frame], [items])`
fn nest_from_list_reads(
    list_reads: &[IrDepPath],
) -> Option<(FieldId, Vec<ListItemFrame>, Vec<vmz_types::PropertyId>)> {
    match list_reads {
        [IrDepPath::Field(id)] | [IrDepPath::Unknown(id)] => Some((*id, vec![], vec![])),
        [IrDepPath::ListItem { list, frames, path }] => Some((*list, frames.clone(), path.clone())),
        _ => None,
    }
}

fn keys_to_paths(b: &mut ReactiveComponentBuilder, keys: &[vmz_types::DepKey]) -> Vec<IrDepPath> {
    let mut out = Vec::new();
    for k in keys {
        if let Some(p) = b.from_dep_key(k) {
            push_unique_path(&mut out, p);
        }
    }
    out
}

/// Parse stable dep string (`user.name` / `count`) into IR path.
fn stable_to_ir(b: &mut ReactiveComponentBuilder, s: &str) -> Option<IrDepPath> {
    if s.ends_with(".*") {
        let root = s.trim_end_matches(".*");
        return b.field_id(root).map(IrDepPath::Unknown);
    }
    let mut parts = s.split('.');
    let root_name = parts.next()?;
    let root = b.field_id(root_name)?;
    let props: Vec<_> = parts.map(|p| b.intern_prop(p)).collect();
    if props.is_empty() {
        Some(IrDepPath::Field(root))
    } else {
        Some(IrDepPath::StaticPath { root, properties: props })
    }
}

fn push_unique_path(out: &mut Vec<IrDepPath>, p: IrDepPath) {
    if !out.iter().any(|x| x == &p) {
        out.push(p);
    }
}

fn sanitize(expr: &str) -> String {
    expr.trim().trim_matches(|c| c == '{' || c == '}').trim().to_string()
}

fn attr_interp(attrs: &[TemplateAttr], name: &str) -> Option<String> {
    attrs.iter().find(|a| a.name == name).and_then(|a| match &a.value {
        AttrValue::Interp(e) => Some(e.clone()),
        AttrValue::Static(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    })
}

fn attr_static(attrs: &[TemplateAttr], name: &str) -> Option<String> {
    attrs.iter().find(|a| a.name == name).map(|a| match &a.value {
        AttrValue::Static(s) => s.clone(),
        AttrValue::Interp(e) => e.trim().trim_matches('"').trim_matches('\'').to_string(),
    })
}

fn has_bare_attr(attrs: &[TemplateAttr], name: &str) -> bool {
    attrs.iter().any(|a| a.name == name)
}

fn is_component_tag(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_uppercase())
}

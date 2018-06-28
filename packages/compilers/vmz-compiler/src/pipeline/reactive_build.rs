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
use crate::template::{AttrValue, TemplateAttr, TemplateIr, TemplateNode};

/// Active keyed `each` frame for ListItem path construction (supports nested each).
#[derive(Debug, Clone)]
struct EachFrame {
    list: FieldId,
    /// Outermost → this frame (inclusive).
    frames: Vec<ListItemFrame>,
    as_name: String,
}

/// Build a [`ReactiveModule`] from component decl + template (bindings, regions, effects).
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

    // Effects use composed summaries (idempotent if analyze already composed).
    let mut methods = decl.methods.clone();
    crate::method_compose::compose_cross_method_rw(&mut methods, &fields);
    for m in &methods {
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        let reads: Vec<IrDepPath> =
            m.reads.iter().filter_map(|s| stable_to_ir(&mut b, s)).collect();
        let writes: Vec<WritePath> = m
            .writes
            .iter()
            .filter_map(|s| stable_to_ir(&mut b, s).map(|path| WritePath { path }))
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

    ReactiveModule {
        schema: REACTIVE_SCHEMA.into(),
        source: source.to_string(),
        components: vec![b.finish()],
    }
}

/// Build the Program IR shell with Reactive as the populated view.
pub fn build_program_module(
    source: &str,
    decl: &ComponentDecl,
    template: &TemplateIr,
) -> ProgramModule {
    build_program_module_with_server(source, decl, template, None, None)
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
    if let Some(unit) = program.units.first_mut() {
        if let Some(attach) = server {
            unit.attach_server(attach);
        }
        // structural tree on ViewView (sole structure source for emit_direct).
        unit.view = crate::structural_build::build_native_view(template, &unit.reactive, routes);
        // shared Execution Plan derived from Native View.
        unit.plan = crate::plan_build::build_execution_plan(&unit.view);
        // lifetime / owns / disposes need Native View region kinds.
        unit.rebuild_projected_views();
    }
    program
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

    let src = format!("({expr})");
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
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

fn is_event_attr(name: &str) -> bool {
    name.starts_with('@') || (name.starts_with("on") && name.len() > 2)
}

fn is_component_tag(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_uppercase())
}

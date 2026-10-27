//! Moved from `src/pipeline/reactive_build.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::pipeline::reactive_build::*;
use vmz_compiler::template::parse_template;
use vmz_types::SourceRange as Span;
use vmz_types::{BindingKind, ComponentDecl, FieldDecl, FieldKind, MethodDecl, Visibility};

#[test]
fn ternary_builds_control_region_with_body_reads() {
    let mut decl = ComponentDecl::new("T", Span::default(), Span::default());
    for name in ["enabled", "user", "account"] {
        decl.fields.push(FieldDecl {
            name: name.into(),
            type_text: None,
            init_text: None,
            kind: FieldKind::State,
            visibility: Visibility::Private,
            span: Span::default(),
            name_span: Span::default(),
        });
    }
    let tpl = parse_template(r#"{{ enabled ? user.name : account.name }}"#).unwrap();
    let module = build_reactive_module("T.vmz", &decl, &tpl);
    let c = &module.components[0];
    assert_eq!(c.control_regions.len(), 1, "ternary must create one region");
    let r = &c.control_regions[0];
    assert_eq!(r.branches.len(), 2);
    let cons = c.transitional_deps(&r.branches[0].body_reads);
    let alt = c.transitional_deps(&r.branches[1].body_reads);
    assert!(cons.iter().any(|d| d == "user.name"), "{cons:?}");
    assert!(alt.iter().any(|d| d == "account.name"), "{alt:?}");
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text");
    assert_eq!(text.region(), Some(r.id));
}

#[test]
fn distinguishes_user_name_and_bio() {
    let mut decl = ComponentDecl::new("UserCard", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "user".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    decl.fields.push(FieldDecl {
        name: "tags".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl = parse_template(
        r#"<p v-if="!user">L</p><div v-else><h2>{{ user.name }}</h2><p>{{ user.bio }}</p><li v-for="tag in tags" :key="tag">{{ tag }}</li></div>"#,
    )
    .unwrap();
    let module = build_reactive_module("UserCard.vmz", &decl, &tpl);
    let json = module.to_json();
    assert!(json.contains("user.name"), "{json}");
    assert!(json.contains("user.bio"), "{json}");
    assert!(json.contains("\"kind\": \"static-path\""), "{json}");
    assert!(json.contains("each-list"), "{json}");
    assert!(json.contains("\"kind\": \"list-item\""), "{json}");
    let c = &module.components[0];
    assert!(!c.control_regions.is_empty());
    let stables: Vec<String> = c
        .bindings
        .iter()
        .flat_map(|b| {
            b.reads().iter().map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        })
        .collect();
    assert!(stables.iter().any(|s| s == "user.name"));
    assert!(stables.iter().any(|s| s == "user.bio"));
    assert!(
        stables.iter().any(|s| s == "tags[key=tag]"),
        "whole-item each body should be ListItem: {stables:?}"
    );
}

#[test]
fn keyed_each_item_prop_is_list_item() {
    let mut decl = ComponentDecl::new("TagList", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "tags".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl =
        parse_template(r#"<li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li>"#).unwrap();
    let module = build_reactive_module("TagList.vmz", &decl, &tpl);
    let c = &module.components[0];
    let stables: Vec<String> = c
        .bindings
        .iter()
        .flat_map(|b| {
            b.reads().iter().map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        })
        .collect();
    assert!(
        stables.iter().any(|s| s == "tags[key=tag.id].label"),
        "item leaf must be ListItem: {stables:?}"
    );
    assert!(
        stables.iter().any(|s| s == "tags[key=tag.id].id"),
        "key expr tag.id must be ListItem: {stables:?}"
    );
    let json = module.to_json();
    assert!(json.contains("\"kind\": \"list-item\""), "{json}");
    // Path channel: ListItem leaf props → tags.*.label (not bare tags.*).
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text binding");
    let transitional = c.transitional_deps(text.reads());
    assert_eq!(transitional, vec!["tags.*.label".to_string()]);
}

#[test]
fn v_memo_marker_has_no_binding_but_children_do() {
    let mut decl = ComponentDecl::new("MemoDemo", Span::default(), Span::default());
    for name in ["x", "y"] {
        decl.fields.push(FieldDecl {
            name: name.into(),
            type_text: None,
            init_text: None,
            kind: FieldKind::State,
            visibility: Visibility::Private,
            span: Span::default(),
            name_span: Span::default(),
        });
    }
    let tpl = parse_template(r#"<div v-memo="[x]">{{ y }}</div>"#).unwrap();
    let module = build_reactive_module("MemoDemo.vmz", &decl, &tpl);
    let c = &module.components[0];
    // 标记本身不是 prop / attr：只有子节点插值的 binding。
    assert!(
        !c.bindings.iter().any(|b| b.kind() == BindingKind::Attr && b.attr() == Some("v-memo")),
        "v-memo marker must not create an attr binding: {:?}",
        c.bindings.iter().map(|b| (b.kind(), b.attr())).collect::<Vec<_>>()
    );
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text binding");
    let deps = c.transitional_deps(text.reads());
    assert_eq!(deps, vec!["y".to_string()], "child interpolation keeps its own deps: {deps:?}");
}

#[test]
fn dynamic_index_path_is_dynamic_path() {
    let mut decl = ComponentDecl::new("Pick", Span::default(), Span::default());
    for name in ["items", "selected"] {
        decl.fields.push(FieldDecl {
            name: name.into(),
            type_text: None,
            init_text: None,
            kind: FieldKind::State,
            visibility: Visibility::Private,
            span: Span::default(),
            name_span: Span::default(),
        });
    }
    let tpl = parse_template(r#"{{ items[selected].label }}"#).unwrap();
    let module = build_reactive_module("Pick.vmz", &decl, &tpl);
    let c = &module.components[0];
    let stables: Vec<String> = c
        .bindings
        .iter()
        .flat_map(|b| {
            b.reads().iter().map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        })
        .collect();
    assert!(
        stables.iter().any(|s| s == "items[selected].label"),
        "must be DynamicPath: {stables:?}"
    );
    let json = module.to_json();
    assert!(json.contains("\"kind\": \"dynamic-path\""), "{json}");
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text");
    let transitional = c.transitional_deps(text.reads());
    assert!(transitional.iter().any(|d| d == "items.*.label"), "{transitional:?}");
    assert!(transitional.iter().any(|d| d == "selected"), "{transitional:?}");
}

#[test]
fn nested_each_alias_list_is_nested_list_item() {
    let mut decl = ComponentDecl::new("Groups", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "groups".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl = parse_template(
        r#"<div v-for="g in groups" :key="g.id"><span v-for="item in g.items" :key="item.id">{{ item.label }}</span></div>"#,
    )
    .unwrap();
    let module = build_reactive_module("Groups.vmz", &decl, &tpl);
    let c = &module.components[0];
    let stables: Vec<String> = c
        .bindings
        .iter()
        .flat_map(|b| {
            b.reads().iter().map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        })
        .collect();
    assert!(
        stables.iter().any(|s| s == "groups[key=g.id].items[key=item.id].label"),
        "nested ListItem required: {stables:?}"
    );
    assert!(
        stables.iter().any(|s| s == "groups[key=g.id].items"),
        "nested each list expr should be ListItem path: {stables:?}"
    );
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text");
    let transitional = c.transitional_deps(text.reads());
    assert_eq!(transitional, vec!["groups.*.items.*.label".to_string()], "{transitional:?}");
}

#[test]
fn multi_segment_dynamic_index_path() {
    let mut decl = ComponentDecl::new("Grid", Span::default(), Span::default());
    for name in ["rows", "ri", "ci"] {
        decl.fields.push(FieldDecl {
            name: name.into(),
            type_text: None,
            init_text: None,
            kind: FieldKind::State,
            visibility: Visibility::Private,
            span: Span::default(),
            name_span: Span::default(),
        });
    }
    let tpl = parse_template(r#"{{ rows[ri].cells[ci].value }}"#).unwrap();
    let module = build_reactive_module("Grid.vmz", &decl, &tpl);
    let c = &module.components[0];
    let stables: Vec<String> = c
        .bindings
        .iter()
        .flat_map(|b| {
            b.reads().iter().map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        })
        .collect();
    assert!(
        stables.iter().any(|s| s == "rows[ri].cells[ci].value"),
        "multi-segment DynamicPath required: {stables:?}"
    );
    let text = c.bindings.iter().find(|b| b.kind() == BindingKind::Text).expect("text");
    let transitional = c.transitional_deps(text.reads());
    assert!(transitional.iter().any(|d| d == "rows.*.cells.*.value"), "{transitional:?}");
    assert!(transitional.iter().any(|d| d == "ri"), "{transitional:?}");
    assert!(transitional.iter().any(|d| d == "ci"), "{transitional:?}");
}

#[test]
fn each_without_proveable_list_field_skips_list_item() {
    let mut decl = ComponentDecl::new("Mixed", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "a".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    decl.fields.push(FieldDecl {
        name: "b".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    // Ternary list ?not a single Field root ?no ListItem frame.
    let tpl =
        parse_template(r#"<li v-for="item in (a ? a : b)" :key="item">{{ item }}</li>"#).unwrap();
    let module = build_reactive_module("Mixed.vmz", &decl, &tpl);
    let json = module.to_json();
    assert!(
        !json.contains("\"kind\": \"list-item\""),
        "unproveable list root must not invent ListItem: {json}"
    );
}

#[test]
fn program_module_lifts_reactive_view() {
    let mut decl = ComponentDecl::new("UserCard", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "user".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl = parse_template("<h2>{{ user.name }}</h2>").unwrap();
    let program = build_program_module("UserCard.vmz", &decl, &tpl);
    let json = program.to_json();
    assert!(json.contains("vmz.program.v0"), "{json}");
    assert!(json.contains("\"semantic\""), "{json}");
    assert!(json.contains("user.name"), "{json}");
    assert_eq!(program.units[0].semantic.fields[0].name, "user");
    assert!(!program.units[0].view.binding_ids.is_empty());
    assert_eq!(program.units[0].view.status, vmz_types::ViewStatus::Native);
    assert!(!program.units[0].view.roots.is_empty());
}

#[test]
fn program_module_attaches_server_capabilities() {
    use vmz_types::{HttpRoute, MethodDecl, ServerAttach};

    let mut decl = ComponentDecl::new("UserCard", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "user".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl = parse_template("<h2>{{ user.name }}</h2>").unwrap();
    let attach = ServerAttach {
        module_id: "#server/components/UserCard".into(),
        class_name: "UserCardServer".into(),
        methods: vec![
            MethodDecl {
                name: "fetchUser".into(),
                is_async: true,
                is_static: false,
                is_private: false,
                http: None,
                reads: vec![],
                writes: vec![],
                calls: vec![],
                opaque_callee: false,
                star_reasons: Vec::new(),
                span: Span::default(),
                name_span: Span::default(),
            },
            MethodDecl {
                name: "getMe".into(),
                is_async: true,
                is_static: false,
                is_private: false,
                http: Some(HttpRoute { verb: "GET".into(), path: "/api/users/me".into() }),
                reads: vec![],
                writes: vec![],
                calls: vec![],
                opaque_callee: false,
                star_reasons: Vec::new(),
                span: Span::default(),
                name_span: Span::default(),
            },
        ],
        client_calls: vmz_compiler::server_calls::collect_server_class_calls(
            r#"
export default class UserCard {
  async onMount() {
this.user = await UserCardServer.fetchUser();
  }
}
"#,
            "UserCardServer",
        ),
        secret_requirements: vec![],
    };
    let program =
        build_program_module_with_server("UserCard.vmz", &decl, &tpl, Some(&attach), None);
    let server = &program.units[0].server;
    assert_eq!(server.status, vmz_types::StubStatus::Partial);
    assert_eq!(server.module_id.as_deref(), Some("#server/components/UserCard"));
    assert!(server.capabilities.iter().any(|c| c.method == "fetchUser"));
    assert!(server.capabilities.iter().any(|c| {
        c.method == "getMe"
            && c.http.as_ref().is_some_and(|h| h.verb == "GET" && h.path == "/api/users/me")
    }));
    assert!(
        server.calls.iter().any(|e| {
            e.method == "fetchUser" && e.from_client_method.as_deref() == Some("onMount")
        }),
        "client call edge missing: {:?}",
        server.calls
    );
    let json = program.to_json();
    assert!(json.contains("\"status\": \"partial\""), "{json}");
    assert!(json.contains("/api/users/me"), "{json}");
}

#[test]
fn effect_records_sibling_method_calls() {
    use vmz_types::MethodDecl;

    let mut decl = ComponentDecl::new("Card", Span::default(), Span::default());
    decl.fields.push(FieldDecl {
        name: "user".into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    });
    decl.methods.push(MethodDecl {
        name: "onClick".into(),
        is_async: false,
        is_static: false,
        is_private: false,
        http: None,
        reads: vec![],
        writes: vec![],
        calls: vec!["refresh".into()],
        opaque_callee: false,
        star_reasons: Vec::new(),
        span: Span::default(),
        name_span: Span::default(),
    });
    decl.methods.push(MethodDecl {
        name: "refresh".into(),
        is_async: false,
        is_static: false,
        is_private: false,
        http: None,
        reads: vec![],
        writes: vec!["user.name".into()],
        calls: vec![],
        opaque_callee: false,
        star_reasons: Vec::new(),
        span: Span::default(),
        name_span: Span::default(),
    });
    let tpl = parse_template(r#"<button @click="onClick">{{ user.name }}</button>"#).unwrap();
    let module = build_reactive_module("Card.vmz", &decl, &tpl);
    let c = &module.components[0];
    let on_click = c.effects.iter().find(|e| e.name == "onClick").expect("onClick effect");
    assert_eq!(on_click.calls, vec!["refresh".to_string()]);
    let write_keys: Vec<String> = on_click
        .writes
        .iter()
        .map(|w| w.path.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        .collect();
    assert!(
        write_keys.iter().any(|k| k == "user.name"),
        "onClick effect should compose refresh writes: {write_keys:?}"
    );
}

#[test]
fn semantic_if_chain_builds_control_region_without_flat_attr_guess() {
    let mut decl = ComponentDecl::new("T", Span::default(), Span::default());
    for name in ["show", "aText", "bText"] {
        decl.fields.push(FieldDecl {
            name: name.into(),
            type_text: None,
            init_text: None,
            kind: FieldKind::State,
            visibility: Visibility::Private,
            span: Span::default(),
            name_span: Span::default(),
        });
    }
    let (sem, ir) = vmz_compiler::parse_template_asts(
        r#"<div><p v-if="show">{{ aText }}</p><p v-else>{{ bText }}</p></div>"#,
    )
    .unwrap();
    assert!(
        matches!(sem.roots[0], vmz_compiler::SemanticNode::Element { .. }),
        "outer element wraps IfChain"
    );
    let module = build_reactive_module_from_semantic("T.vmz", &decl, &sem);
    let legacy = build_reactive_module("T.vmz", &decl, &ir);
    let c = &module.components[0];
    let if_regions: Vec<_> = c
        .control_regions
        .iter()
        .filter(|r| {
            r.branches.len() == 2 && r.branches[0].cond.is_some() && r.branches[1].cond.is_none()
        })
        .collect();
    assert_eq!(
        if_regions.len(),
        1,
        "Semantic IfChain → one if/else region; got {:?}",
        c.control_regions.len()
    );
    assert!(c.bindings.iter().any(|b| b.kind() == BindingKind::IfCond), "IfCond binding required");
    // Same branch count as legacy TemplateIr walk (compat during dual-path).
    let legacy_if =
        legacy.components[0].control_regions.iter().filter(|r| r.branches.len() == 2).count();
    assert_eq!(if_regions.len(), legacy_if.max(1));
}

fn state_field(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        type_text: None,
        init_text: None,
        kind: FieldKind::State,
        visibility: Visibility::Private,
        span: Span::default(),
        name_span: Span::default(),
    }
}

fn member(name: &str, reads: &[&str], calls: &[&str]) -> MethodDecl {
    MethodDecl {
        name: name.into(),
        is_async: false,
        is_static: false,
        is_private: false,
        http: None,
        reads: reads.iter().map(|s| (*s).to_string()).collect(),
        writes: vec![],
        calls: calls.iter().map(|s| (*s).to_string()).collect(),
        opaque_callee: false,
        star_reasons: Vec::new(),
        span: Span::default(),
        name_span: Span::default(),
    }
}

fn binding_reads(module: &vmz_types::ReactiveModule, attr: &str) -> Vec<String> {
    let c = &module.components[0];
    let binding = c
        .bindings
        .iter()
        .find(|b| b.kind() == BindingKind::Attr && b.attr() == Some(attr))
        .unwrap_or_else(|| panic!("missing `{attr}` binding"));
    binding
        .reads()
        .iter()
        .map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        .collect()
}

#[test]
fn html_binding_expands_method_reads_end_to_end() {
    // Whole chain: Oak analysis (getter / call edges + template-string holes) →
    // reactive binding reads.
    let src = r#"
export default class Chart {
  spec = null;
  data = [];
  width = 0;
  height = 0;
  scene() {
    return { spec: this.spec, rows: this.data, w: this.width, h: this.height };
  }
  markup() {
    return this.scene();
  }
  hostStyle() {
    return `width:${this.width}px;height:${this.height}px;position:relative`;
  }
}
"#;
    let analyzed =
        vmz_compiler::parse::analyze::analyze_script(vmz_compiler::ScriptKind::Client, src);
    let decl = analyzed.decl;
    let method_reads: Vec<(String, Vec<String>)> =
        decl.methods.iter().map(|m| (m.name.clone(), m.reads.clone())).collect();
    assert!(analyzed.parse_errors.is_empty(), "{:?}", analyzed.parse_errors);
    assert!(
        method_reads.iter().any(|(n, r)| n == "hostStyle" && r.iter().any(|x| x == "width")),
        "{method_reads:?}"
    );
    let tpl = parse_template(r#"<div :style="hostStyle()" v-html="markup()"></div>"#).unwrap();
    let module = build_reactive_module("Chart.vmz", &decl, &tpl);
    let html = binding_reads(&module, "html");
    for name in ["spec", "data", "width", "height"] {
        assert!(html.iter().any(|r| r == name), "html binding must read `{name}`: {html:?}");
    }
    let style = binding_reads(&module, "style");
    assert!(style.iter().any(|r| r == "width"), "style binding reads: {style:?}");
    assert!(style.iter().any(|r| r == "height"), "style binding reads: {style:?}");
    assert!(
        !style.iter().any(|r| r == "spec" || r == "data"),
        "style must stay precise: {style:?}"
    );
    let c = &module.components[0];
    let markup = c.effects.iter().find(|e| e.name == "markup").expect("markup effect");
    let markup_reads: Vec<String> = markup
        .reads
        .iter()
        .map(|r| r.to_stable_string(&c.state_slots, &c.properties, &c.exprs))
        .collect();
    assert!(markup_reads.iter().any(|r| r == "spec"), "markup effect reads: {markup_reads:?}");
    assert!(markup_reads.iter().any(|r| r == "data"), "markup effect reads: {markup_reads:?}");
    let host = c.effects.iter().find(|e| e.name == "hostStyle").expect("hostStyle effect");
    assert!(!host.reads.is_empty(), "template-string holes must reach the effect summary");
}

#[test]
fn semantic_path_html_binding_expands_method_reads() {
    // Production builds walk the Semantic AST; keep the same member expansion there.
    let src = r#"
export default class Chart {
  spec = null;
  data = [];
  width = 0;
  height = 0;
  scene() {
    return { spec: this.spec, rows: this.data, w: this.width, h: this.height };
  }
  markup() {
    return this.scene();
  }
  hostStyle() {
    return `width:${this.width}px;height:${this.height}px;position:relative`;
  }
}
"#;
    let analyzed =
        vmz_compiler::parse::analyze::analyze_script(vmz_compiler::ScriptKind::Client, src);
    let decl = analyzed.decl;
    let (sem, _ir) =
        vmz_compiler::parse_template_asts(r#"<div :style="hostStyle()" v-html="markup()"></div>"#)
            .unwrap();
    let module = build_reactive_module_from_semantic("Chart.vmz", &decl, &sem);
    let html = binding_reads(&module, "html");
    for name in ["spec", "data", "width", "height"] {
        assert!(html.iter().any(|r| r == name), "html binding must read `{name}`: {html:?}");
    }
    let style = binding_reads(&module, "style");
    assert!(style.iter().any(|r| r == "width"), "style binding reads: {style:?}");
    assert!(style.iter().any(|r| r == "height"), "style binding reads: {style:?}");
}

#[test]
fn getter_binding_value_expands_composed_reads() {
    let mut decl = ComponentDecl::new("Chart", Span::default(), Span::default());
    decl.fields.push(state_field("spec"));
    decl.fields.push(state_field("data"));
    decl.methods.push(member("markup", &["spec", "data"], &[]));
    // A getter used as a binding value (no call parentheses).
    let tpl = parse_template(r#"<div v-html="markup"></div>"#).unwrap();
    let module = build_reactive_module("Chart.vmz", &decl, &tpl);
    let reads = binding_reads(&module, "html");
    assert!(reads.iter().any(|r| r == "spec"), "{reads:?}");
    assert!(reads.iter().any(|r| r == "data"), "{reads:?}");
}

#[test]
fn unknown_member_and_dynamic_access_stay_conservative() {
    let mut decl = ComponentDecl::new("Chart", Span::default(), Span::default());
    decl.fields.push(state_field("data"));
    decl.fields.push(state_field("keyName"));
    decl.methods.push(member("markup", &["data"], &[]));
    // Imported / external callee: only the field it passes is a dep.
    let tpl = parse_template(r#"<div v-html="format(data)"></div>"#).unwrap();
    let module = build_reactive_module("Chart.vmz", &decl, &tpl);
    assert_eq!(binding_reads(&module, "html"), vec!["data".to_string()]);
    // Dynamic member access: no member dep, no field guess.
    let tpl = parse_template(r#"<div v-html="this[keyName]"></div>"#).unwrap();
    let module = build_reactive_module("Chart.vmz", &decl, &tpl);
    assert_eq!(binding_reads(&module, "html"), vec!["keyName".to_string()]);
}

#[test]
fn constant_attr_and_text_add_no_binding() {
    let mut decl = ComponentDecl::new("ConstBindings", Span::default(), Span::default());
    decl.fields.push(state_field("seed"));
    let tpl =
        parse_template(r#"<div :title="'a' + 'b'" :data-n="1 + 2">{{ 'x' + 'y' }}</div>"#).unwrap();
    let module = build_reactive_module("ConstBindings.vmz", &decl, &tpl);
    let c = &module.components[0];
    let json = module.to_json();
    assert!(c.bindings.is_empty(), "constant bindings must not subscribe: {json}");
    assert!(c.control_regions.is_empty(), "{json}");
    assert!(!json.contains("'a' + 'b'"), "constant expr must not be interned: {json}");
    assert!(!json.contains("'x' + 'y'"), "constant expr must not be interned: {json}");
}

#[test]
fn constant_v_if_adds_no_control_region() {
    let mut decl = ComponentDecl::new("ConstBranch", Span::default(), Span::default());
    decl.fields.push(state_field("enabled"));
    let tpl = parse_template(
        r#"<p v-if="false">{{ enabled }}</p><p v-else-if="true">{{ 'live' }}</p><p v-else>x</p>"#,
    )
    .unwrap();
    let module = build_reactive_module("ConstBranch.vmz", &decl, &tpl);
    let c = &module.components[0];
    let json = module.to_json();
    assert!(c.control_regions.is_empty(), "constant if chain needs no region: {json}");
    assert!(c.bindings.is_empty(), "dead branch reads and constant text must not bind: {json}");
    assert!(!json.contains("if-cond"), "{json}");
}

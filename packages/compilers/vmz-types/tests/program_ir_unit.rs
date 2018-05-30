//! Moved from `src/program_ir.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::*;

#[test]
fn program_wraps_reactive_as_one_view() {
    let mut b = ReactiveComponentBuilder::new("Card");
    b.add_field("user", FieldKind::State);
    let expr = b.intern_expr("user.name");
    let reads = vec![
        b.from_dep_key(&vmz_types::DepKey::path(vmz_types::DepPath::prop("user", "name"))).unwrap(),
    ];
    b.add_binding(BindingKind::Text, reads, None, Some(expr), None);
    let reactive = ReactiveModule { source: "Card.vmz".into(), components: vec![b.finish()] };
    let program = ProgramModule::from_reactive(reactive);
    let json = program.to_json();
    assert!(json.contains(PROGRAM_SCHEMA), "{json}");
    assert!(json.contains("\"semantic\""), "{json}");
    assert!(json.contains("\"reactive\""), "{json}");
    assert!(json.contains("derived_from_reactive"), "{json}");
    assert!(json.contains("user.name"), "{json}");
    assert!(json.contains("\"graph\""), "{json}");
    assert!(json.contains("\"edges\""), "{json}");
    assert!(json.contains("\"reads\""), "{json}");
    // resource empty (no async/server); graph partial (has binding reads)
    assert!(json.contains("\"status\": \"empty\""), "{json}");
    assert!(json.contains("\"status\": \"partial\""), "{json}");
    let u = &program.units[0];
    assert_eq!(u.semantic.fields[0].name, "user");
    assert_eq!(u.view.binding_ids.len(), 1);
    assert_eq!(u.reactive.bindings[0].id, u.view.binding_ids[0]);
    assert!(!u.graph.edges.is_empty());
    assert_eq!(u.graph.edges[0].kind, "reads");
    assert_eq!(u.graph.edges[0].to, "user.name");
}

#[test]
fn resource_and_call_edges_from_server_attach() {
    use oxc_span::SPAN;
    let mut b = ReactiveComponentBuilder::new("Card");
    b.add_field("user", FieldKind::State);
    b.add_effect("onMount", vec![], vec![], true, vec![], false, vec![]);
    let reactive = b.finish();
    let mut unit = ProgramUnit::from_reactive_component(UnitId(0), reactive);
    unit.attach_server(&ServerAttach {
        module_id: "#server/components/Card".into(),
        class_name: "CardServer".into(),
        methods: vec![vmz_types::MethodDecl {
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
            span: SPAN,
        }],
        client_calls: vec![ClientServerCall {
            server_method: "fetchUser".into(),
            from_client_method: Some("onMount".into()),
        }],
    });
    assert_eq!(unit.resource.status, StubStatus::Partial);
    assert!(unit.resource.resources.iter().any(|r| r.kind == "async_task"
        && r.name == "onMount"
        && r.cancelable
        && r.generation
        && r.states.iter().any(|s| s == "cancelled")));
    assert!(
        unit.resource
            .resources
            .iter()
            .any(|r| r.kind == "server_capability" && r.name == "fetchUser")
    );
    assert!(unit.graph.edges.iter().any(|e| {
        e.kind == "calls" && e.from == "effect:onMount" && e.to == "capability:fetchUser"
    }));
    assert!(unit.graph.edges.iter().any(|e| {
        e.kind == "spawns" && e.from == "effect:onMount" && e.to.starts_with("task:")
    }));
    assert!(unit.graph.edges.iter().any(|e| {
        e.kind == "cancels" && e.from == "lifecycle:destroy" && e.to.starts_with("task:")
    }));
}

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
    let reactive = ReactiveModule {
        schema: REACTIVE_SCHEMA.into(),
        source: "Card.vmz".into(),
        components: vec![b.finish()],
    };
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
    let mut unit = ProgramUnit::from_reactive_component(UnitId { unit_id: 0 }, reactive);
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
        secret_requirements: vec![],
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

#[test]
fn motion_view_from_overlay_markers_and_cancel_method() {
    let mut b = ReactiveComponentBuilder::new("Dialog");
    b.add_field("open", FieldKind::State);
    b.add_effect("dismiss", vec![], vec![], false, vec![], false, vec![]);
    b.add_effect("_cancelExit", vec![], vec![], false, vec![], false, vec![]);
    b.add_effect("_enterFocus", vec![], vec![], false, vec![], false, vec![]);
    let mut unit = ProgramUnit::from_reactive_component(UnitId { unit_id: 0 }, b.finish());
    unit.view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![],
        region_ids: vec![RegionId(0)],
        roots: vec![ViewNode::If {
            region: Some(RegionId(0)),
            binding: None,
            branches: vec![ViewIfBranch {
                cond: Some("open".into()),
                body: Box::new(ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![
                        ViewAttr {
                            name: "data-vmz-overlay".into(),
                            value: ViewAttrValue::Static { value: "dialog".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "data-vmz-motion".into(),
                            value: ViewAttrValue::Static { value: "overlay-enter".into() },
                            binding: None,
                        },
                    ],
                    children: vec![],
                    each: None,
                }),
            }],
        }],
    };
    unit.plan = ExecutionPlan::default();
    unit.rebuild_projected_views();

    assert_eq!(unit.motion.status, StubStatus::Partial);
    assert!(unit.motion.transitions.iter().any(|t| {
        t.kind == "overlay-enter"
            && t.trigger == "open"
            && t.cancelable
            && t.generation
            && t.region == Some(0)
            && t.token == "motion.overlay"
    }));
    assert!(unit.motion.transitions.iter().any(|t| {
        t.kind == "overlay-exit" && t.trigger == "dismiss" && t.cancelable && t.generation
    }));
    assert!(unit.graph.edges.iter().any(|e| {
        e.kind == "cancels" && e.from == "effect:_cancelExit" && e.to.starts_with("motion:")
    }));
    assert!(unit.graph.edges.iter().any(|e| {
        e.kind == "cancels" && e.from == "motion:reverse" && e.to.starts_with("motion:")
    }));
    assert!(
        unit.graph.edges.iter().any(|e| {
            e.kind == "affects" && e.from.starts_with("motion:") && e.to == "region:0"
        })
    );
    assert!(unit.plan.nodes.iter().any(|n| n.kind == "motion_transition"));
    let json = ProgramModule {
        schema: PROGRAM_SCHEMA.into(),
        source: "Dialog.vmz".into(),
        units: vec![unit],
    }
    .to_json();
    assert!(json.contains("\"motion\""), "{json}");
    assert!(json.contains("overlay-enter"), "{json}");
    assert!(json.contains("motion.overlay"), "{json}");
    assert!(json.contains("\"affects\""), "{json}");
    assert!(json.contains("motion:reverse") || json.contains("effect:_cancelExit"), "{json}");
}

#[test]
fn motion_author_token_override_from_view_attr() {
    let mut b = ReactiveComponentBuilder::new("Panel");
    b.add_field("open", FieldKind::State);
    b.add_effect("_cancelExit", vec![], vec![], false, vec![], false, vec![]);
    let mut unit = ProgramUnit::from_reactive_component(UnitId { unit_id: 0 }, b.finish());
    unit.view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![],
        region_ids: vec![RegionId(0)],
        roots: vec![ViewNode::If {
            region: Some(RegionId(0)),
            binding: None,
            branches: vec![ViewIfBranch {
                cond: Some("open".into()),
                body: Box::new(ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![
                        ViewAttr {
                            name: "data-vmz-overlay".into(),
                            value: ViewAttrValue::Static { value: "panel".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "data-vmz-motion".into(),
                            value: ViewAttrValue::Static { value: "overlay-enter".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "data-vmz-motion-token".into(),
                            value: ViewAttrValue::Static { value: "motion.custom-panel".into() },
                            binding: None,
                        },
                    ],
                    children: vec![],
                    each: None,
                }),
            }],
        }],
    };
    unit.plan = ExecutionPlan::default();
    unit.rebuild_projected_views();
    assert!(
        unit.motion
            .transitions
            .iter()
            .any(|t| { t.kind == "overlay-enter" && t.token == "motion.custom-panel" })
    );
    assert!(
        unit.motion
            .transitions
            .iter()
            .any(|t| { t.kind == "overlay-exit" && t.token == "motion.custom-panel" })
    );
}

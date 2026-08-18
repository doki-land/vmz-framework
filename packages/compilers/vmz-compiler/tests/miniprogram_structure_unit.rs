//! Structure / lifecycle unit tests.

use vmz_compiler::miniprogram::structure::{MINI_LIFECYCLE_TABLE_SCHEMA, lower_unit_structure};
use vmz_protocol::VmzModuleKind;
use vmz_types::{
    Binding, BindingId, DeploymentView, DisposeRegionSource, ExecutionPlan, FieldId, FieldKind,
    IrDepPath, LifetimeRegionDecl, LifetimeRegionKind, LifetimeView, PlanNode, PlanStatus,
    ProgramUnit, ProgramUnitKind, ReactiveComponent, StateSlot, StubStatus, UnitId, ViewAttr,
    ViewAttrValue, ViewEach, ViewIfBranch, ViewNode, ViewStatus, ViewView,
};

fn sample_unit() -> ProgramUnit {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![BindingId(0), BindingId(1), BindingId(2)],
        region_ids: vec![],
        roots: vec![
            ViewNode::Element {
                tag: "li".into(),
                attrs: vec![],
                children: vec![ViewNode::Interp {
                    expr: "it.name".into(),
                    binding: Some(BindingId(1)),
                }],
                each: Some(ViewEach {
                    list_expr: "items".into(),
                    as_name: "it".into(),
                    key_expr: Some("it.id".into()),
                    list_binding: Some(BindingId(0)),
                    key_binding: None,
                    region: Some(vmz_types::RegionId(0)),
                }),
            },
            ViewNode::Component {
                tag: "Badge".into(),
                attrs: vec![ViewAttr {
                    name: "label".into(),
                    value: ViewAttrValue::Interp { expr: "title".into() },
                    binding: Some(BindingId(2)),
                }],
                children: vec![],
            },
            ViewNode::If {
                region: Some(vmz_types::RegionId(1)),
                binding: Some(BindingId(3)),
                branches: vec![ViewIfBranch {
                    cond: Some("show".into()),
                    body: Box::new(ViewNode::Text { value: "hi".into() }),
                }],
            },
            ViewNode::Slot { name: None, attrs: vec![], children: vec![] },
        ],
    };
    let reactive = ReactiveComponent {
        name: "IndexPage".into(),
        state_slots: vec![StateSlot {
            id: FieldId(0),
            name: "items".into(),
            kind: FieldKind::State,
        }],
        properties: vec![],
        bindings: vec![
            Binding::EachList {
                id: BindingId(0),
                reads: vec![IrDepPath::Field(FieldId(0))],
                region: None,
                expr: None,
            },
            Binding::Text { id: BindingId(1), reads: vec![], region: None, expr: None },
            Binding::ComponentProp {
                id: BindingId(2),
                reads: vec![],
                region: None,
                expr: None,
                attr: "label".into(),
            },
            Binding::IfCond { id: BindingId(3), reads: vec![], region: None, expr: None },
        ],
        effects: vec![],
        control_regions: vec![],
        exprs: vec![],
    };
    ProgramUnit {
        id: UnitId { unit_id: 0 },
        name: "IndexPage".into(),
        kind: ProgramUnitKind::Component,
        semantic: Default::default(),
        reactive,
        view,
        plan: ExecutionPlan {
            schema: "vmz.plan.v0".into(),
            status: PlanStatus::Partial,
            root_ids: vec![],
            nodes: vec![
                PlanNode::DisposeRegion {
                    id: 10,
                    region: Some(0),
                    source: Some(DisposeRegionSource::Each),
                },
                PlanNode::DisposeRegion {
                    id: 11,
                    region: Some(1),
                    source: Some(DisposeRegionSource::If),
                },
            ],
        },
        resource: Default::default(),
        motion: Default::default(),
        lifetime: LifetimeView {
            status: StubStatus::Partial,
            regions: vec![
                LifetimeRegionDecl {
                    id: 0,
                    kind: LifetimeRegionKind::Each,
                    owner_unit: "IndexPage".into(),
                },
                LifetimeRegionDecl {
                    id: 1,
                    kind: LifetimeRegionKind::If,
                    owner_unit: "IndexPage".into(),
                },
            ],
        },
        server: Default::default(),
        deployment: DeploymentView {
            status: StubStatus::Partial,
            unit_kind: Some(VmzModuleKind::Page),
            chunk_id: Some("pages/index".into()),
            client_entry: None,
            program_ir: None,
            region_ids: vec![],
            capabilities: vec![],
            server_module_id: None,
            client_calls: vec![],
            resume_entries: vec![],
            tab: None,
        },
        graph: Default::default(),
    }
}

#[test]
fn lowers_each_component_if_slot_and_lifecycle() {
    let unit = sample_unit();
    let (art, diags) = lower_unit_structure("mini-program", &unit, "fixture").expect("ok");
    assert!(diags.is_empty(), "{diags:?}");
    let tpl = art.template.as_deref().unwrap();
    assert!(tpl.contains("data-vmz-each=\"b.B_0\""));
    assert!(tpl.contains("data-vmz-as=\"it\""));
    assert!(tpl.contains("<vmz-component name=\"Badge\""));
    assert!(tpl.contains("data-vmz-prop-label=\"{{b.B_2}}\""));
    assert!(tpl.contains("data-vmz-if=\"b.B_3\""));
    assert!(tpl.contains("<slot"));
    assert!(!tpl.contains("wx:"));

    let life: serde_json::Value = serde_json::from_str(art.manifest.as_deref().unwrap()).unwrap();
    assert_eq!(life["schema"], MINI_LIFECYCLE_TABLE_SCHEMA);
    assert_eq!(life["pageHooks"]["onUnload"], "dispose");
    assert!(life["regions"].as_array().unwrap().len() >= 2);
    assert!(life["dispose"].as_array().unwrap().iter().any(|d| d["source"] == "each"));
    assert!(life["dispose"].as_array().unwrap().iter().any(|d| d["source"] == "if"));
}

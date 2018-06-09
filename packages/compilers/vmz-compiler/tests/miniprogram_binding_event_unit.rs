//! Binding/event table unit tests (TemplateSurface).

use vmz_compiler::miniprogram::binding_event::{
    lower_view_binding_event, MINI_DATA_PATCH_TABLE_SCHEMA, MINI_EVENT_TABLE_SCHEMA,
};
use vmz_types::{
    Binding, BindingId, Effect, EffectId, ExprId, FieldId, FieldKind, IrDepPath, ReactiveComponent,
    StateSlot, ViewAttr, ViewAttrValue, ViewNode, ViewStatus, ViewView, WritePath,
};

fn counter_fixture() -> (ViewView, ReactiveComponent) {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![BindingId(0), BindingId(1)],
        region_ids: vec![],
        roots: vec![ViewNode::Element {
            tag: "button".into(),
            attrs: vec![ViewAttr {
                name: "@click".into(),
                value: ViewAttrValue::Interp { expr: "increment".into() },
                binding: Some(BindingId(0)),
            }],
            children: vec![ViewNode::Interp {
                expr: "n".into(),
                binding: Some(BindingId(1)),
            }],
            each: None,
        }],
    };
    let reactive = ReactiveComponent {
        name: "IndexPage".into(),
        state_slots: vec![StateSlot {
            id: FieldId(0),
            name: "n".into(),
            kind: FieldKind::State,
        }],
        properties: vec![],
        bindings: vec![
            Binding::Event {
                id: BindingId(0),
                reads: vec![],
                region: None,
                expr: Some(ExprId(0)),
                attr: "@click".into(),
            },
            Binding::Text {
                id: BindingId(1),
                reads: vec![IrDepPath::Field(FieldId(0))],
                region: None,
                expr: Some(ExprId(1)),
            },
        ],
        effects: vec![Effect {
            id: EffectId(0),
            name: "increment".into(),
            reads: vec![],
            writes: vec![WritePath { path: IrDepPath::Field(FieldId(0)) }],
            async_boundary: false,
            calls: vec![],
            opaque_callee: false,
            star_reasons: vec![],
        }],
        control_regions: vec![],
        exprs: vec![],
    };
    (view, reactive)
}

#[test]
fn counter_emits_handler_and_affected_text_binding() {
    let (view, reactive) = counter_fixture();
    let (art, diags) =
        lower_view_binding_event("mini-program", &view, &reactive, "fixture").expect("ok");
    assert!(diags.is_empty(), "{diags:?}");
    let tpl = art.template.as_deref().unwrap();
    assert!(tpl.contains("data-vmz-on=\"h0\""));
    assert!(tpl.contains("{{b.B_1}}"));
    assert!(!tpl.contains("@click"));

    let events: serde_json::Value =
        serde_json::from_str(art.event_table.as_deref().unwrap()).unwrap();
    assert_eq!(events["schema"], MINI_EVENT_TABLE_SCHEMA);
    let h0 = &events["handlers"][0];
    assert_eq!(h0["handlerId"], "h0");
    assert_eq!(h0["eventKind"], "click");
    assert_eq!(h0["method"], "increment");
    assert_eq!(h0["affectedBindings"][0], 1);
    assert_eq!(h0["patchPaths"][0], "b.B_1");

    let patch: serde_json::Value =
        serde_json::from_str(art.data_patch_table.as_deref().unwrap()).unwrap();
    assert_eq!(patch["schema"], MINI_DATA_PATCH_TABLE_SCHEMA);
    assert!(patch["bindings"].as_array().unwrap().iter().any(|b| b["bindingId"] == 1));
    assert!(patch["fields"].as_array().unwrap().iter().any(|f| {
        f["fieldId"] == 0 && f["affects"].as_array().unwrap().iter().any(|a| a == 1)
    }));
}

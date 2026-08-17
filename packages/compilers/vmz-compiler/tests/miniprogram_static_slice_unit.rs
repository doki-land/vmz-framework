//! Static-slice unit tests (TemplateSurface lowering).

use vmz_compiler::miniprogram::static_slice::{
    MINI_LOGIC_SCHEMA, MINI_TEMPLATE_DIALECT, lower_view_static_slice,
};
use vmz_protocol::DIAG_PLATFORM_UNSUPPORTED;
use vmz_types::{BindingId, ViewNode, ViewStatus, ViewView};

#[test]
fn lowers_hello_counter_static_view() {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![BindingId(0)],
        region_ids: vec![],
        roots: vec![
            ViewNode::Element {
                tag: "p".into(),
                attrs: vec![],
                children: vec![ViewNode::Text { value: "hello".into() }],
                each: None,
            },
            ViewNode::Element {
                tag: "button".into(),
                attrs: vec![],
                children: vec![ViewNode::Interp { expr: "n".into(), binding: Some(BindingId(0)) }],
                each: None,
            },
        ],
    };
    let (art, diags) = lower_view_static_slice("mini-program", &view, "fixture").expect("ok");
    assert!(diags.is_empty(), "{diags:?}");
    let tpl = art.template.as_deref().unwrap();
    assert!(tpl.contains(MINI_TEMPLATE_DIALECT));
    assert!(tpl.contains("hello"));
    assert!(tpl.contains("{{b.B_0}}"));
    assert!(tpl.contains("<button>"));
    assert!(!tpl.contains("wx:"), "must stay vendor-neutral");
    let logic = art.logic.as_deref().unwrap();
    assert!(logic.contains(MINI_LOGIC_SCHEMA));
    assert!(logic.contains("B_0"));
    assert!(art.event_table.is_none(), "events are deferred");
}

#[test]
fn rejects_if_in_static_slice() {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![],
        region_ids: vec![],
        roots: vec![ViewNode::If { region: None, binding: None, branches: vec![] }],
    };
    let err = lower_view_static_slice("mini-program", &view, "fixture").unwrap_err();
    assert!(err.iter().any(|d| d.code_string().as_deref() == Some(DIAG_PLATFORM_UNSUPPORTED)));
}

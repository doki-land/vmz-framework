//! Moved from `src/pipeline/plan_build.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::{PlanNodeKind, PlanStatus};

use vmz_compiler::pipeline::plan_build::*;
use vmz_types::{ViewEach, ViewIfBranch, ViewNode, ViewStatus, ViewView};

#[test]
fn builds_if_and_dispose_region() {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![],
        region_ids: vec![],
        roots: vec![ViewNode::If {
            region: Some(vmz_types::RegionId(0)),
            binding: Some(vmz_types::BindingId(1)),
            branches: vec![ViewIfBranch {
                cond: Some("show".into()),
                body: Box::new(ViewNode::Element {
                    tag: "p".into(),
                    attrs: vec![],
                    children: vec![ViewNode::Text { value: "hi".into() }],
                    each: None,
                }),
            }],
        }],
    };
    let plan = build_execution_plan(&view);
    assert_eq!(plan.status, PlanStatus::Partial);
    assert_eq!(plan.root_ids, vec![0]);
    assert!(plan.nodes.iter().any(|n| n.kind() == PlanNodeKind::If && n.region() == Some(0)));
    assert!(plan.nodes.iter().any(|n| n.kind() == PlanNodeKind::Element && n.tag() == Some("p")));
    assert!(plan.nodes.iter().any(|n| n.kind() == PlanNodeKind::Text));
    assert!(
        plan.nodes.iter().any(|n| n.kind() == PlanNodeKind::DisposeRegion
            && n.region() == Some(0)
            && n.tag() == Some("if")),
        "missing dispose-region: {:?}",
        plan.nodes
    );
}

#[test]
fn builds_each_with_key_binding_and_slot_projection_id() {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![],
        region_ids: vec![],
        roots: vec![ViewNode::Element {
            tag: "ul".into(),
            attrs: vec![],
            children: vec![ViewNode::Element {
                tag: "li".into(),
                attrs: vec![],
                children: vec![ViewNode::Text { value: "x".into() }],
                each: Some(ViewEach {
                    list_expr: "items".into(),
                    as_name: "item".into(),
                    key_expr: Some("item.id".into()),
                    list_binding: Some(vmz_types::BindingId(2)),
                    key_binding: Some(vmz_types::BindingId(3)),
                    region: Some(vmz_types::RegionId(1)),
                }),
            }],
            each: None,
        }],
    };
    let plan = build_execution_plan(&view);
    assert_eq!(plan.status, PlanStatus::Partial);
    let each = plan.nodes.iter().find(|n| n.kind() == PlanNodeKind::Each).expect("each node");
    assert_eq!(each.binding(), Some(2));
    assert_eq!(each.key_binding(), Some(3));
    assert_eq!(each.region(), Some(1));
}

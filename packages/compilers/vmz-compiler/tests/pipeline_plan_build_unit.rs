//! Moved from `src/pipeline/plan_build.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::{PlanNodeKind, PlanStatus};

use vmz_compiler::pipeline::plan_build::*;
use vmz_types::{ViewIfBranch, ViewNode, ViewStatus, ViewView};

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

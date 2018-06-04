//! Moved from `src/miniprogram/target.rs` (cargo-cry: tests next to Cargo.toml).
//!
//! Closed plan fixtures use [`PlanNode`] (tagged enum). Open unknown kinds stay
//! as plain `kind: String` only for negative scanner tests.

use serde::Serialize;
use vmz_compiler::miniprogram::target::*;
use vmz_protocol::*;
use vmz_types::{DisposeRegionSource, PlanNode, PlanNodeKind};

#[derive(Serialize)]
struct PlanFixture {
    plan: PlanNodes,
}

#[derive(Serialize)]
struct PlanNodes {
    nodes: Vec<PlanNode>,
}

/// Negative-test node: **open** model (`kind` is a free-form string on purpose).
#[derive(Serialize)]
struct UnknownPlanNodeFixture {
    kind: &'static str,
}

#[derive(Serialize)]
struct UnknownPlanNodes {
    nodes: Vec<UnknownPlanNodeFixture>,
}

#[derive(Serialize)]
struct UnknownPlanFixture {
    plan: UnknownPlanNodes,
}

fn plan_value(nodes: Vec<PlanNode>) -> serde_json::Value {
    serde_json::to_value(PlanFixture { plan: PlanNodes { nodes } }).expect("fixture serialize")
}

#[test]
fn rejects_document_token_in_plan_json() {
    let mut diags = Vec::new();
    // Forbidden token rides on an otherwise-closed Element payload via `tag`.
    let v = plan_value(vec![PlanNode::Element {
        id: 0,
        tag: Some("document.createElement".into()),
        binding: None,
        region: None,
        children: vec![],
    }]);
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.iter().any(|d| d.code_string().as_deref() == Some(DIAG_DOM_LEAK_IN_PLAN)));
}

#[test]
fn allows_neutral_plan_kinds() {
    let mut diags = Vec::new();
    let v = plan_value(vec![
        PlanNode::Element {
            id: 0,
            tag: Some("button".into()),
            binding: None,
            region: None,
            children: vec![],
        },
        PlanNode::Interp { id: 1, binding: Some(1) },
        PlanNode::DisposeRegion { id: 2, region: Some(2), source: Some(DisposeRegionSource::If) },
    ]);
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.is_empty(), "{diags:?}");

    assert_eq!(PlanNodeKind::Element.as_str(), "element");
    assert_eq!(PlanNodeKind::Interp.as_str(), "interp");
    assert_eq!(PlanNodeKind::DisposeRegion.as_str(), "dispose-region");
}

#[test]
fn rejects_unknown_plan_kind() {
    let mut diags = Vec::new();
    // Open fixture: scanner must reject kinds outside the closed PlanNode set.
    let v = serde_json::to_value(UnknownPlanFixture {
        plan: UnknownPlanNodes { nodes: vec![UnknownPlanNodeFixture { kind: "vdom-diff" }] },
    })
    .expect("fixture serialize");
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.iter().any(|d| d.code_string().as_deref() == Some(DIAG_UNKNOWN_VIEW_OP)));
}

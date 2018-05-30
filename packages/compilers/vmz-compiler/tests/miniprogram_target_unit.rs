//! Moved from `src/miniprogram/target.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_protocol::*;

use serde_json::json;
use vmz_compiler::miniprogram::target::*;

#[test]
fn rejects_document_token_in_plan_json() {
    let mut diags = Vec::new();
    let v = json!({
        "plan": {
            "nodes": [{ "kind": "element", "tag": "div", "note": "document.createElement" }]
        }
    });
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.iter().any(|d| d.code.as_deref() == Some(DIAG_DOM_LEAK_IN_PLAN)));
}

#[test]
fn allows_neutral_plan_kinds() {
    let mut diags = Vec::new();
    let v = json!({
        "plan": {
            "nodes": [
                { "kind": "element", "tag": "button" },
                { "kind": "interp", "binding": 1 },
                { "kind": "dispose_region", "region": 2 }
            ]
        }
    });
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.is_empty(), "{diags:?}");
}

#[test]
fn rejects_unknown_plan_kind() {
    let mut diags = Vec::new();
    let v = json!({ "plan": { "nodes": [{ "kind": "vdom_diff" }] } });
    scan_plan_value_for_dom_leaks("x", &v, &mut diags);
    assert!(diags.iter().any(|d| d.code.as_deref() == Some(DIAG_UNKNOWN_VIEW_OP)));
}

//! Moved from `src/mcp/mod.rs` (cargo-cry: tests next to Cargo.toml).

use serde_json::{Map, Value};

use vmz_debugger::mcp::*;

#[test]
fn lists_debugger_tools() {
    let names: Vec<_> = list_tools().into_iter().map(|t| t.name).collect();
    assert!(names.contains(&TOOL_EXPLAIN.into()));
    assert!(names.contains(&TOOL_CHECK_X5.into()));
}

#[test]
fn call_unknown_is_error() {
    let session = McpSession::new(".", ".");
    let out = call_tool(&session, "nope", Value::Object(Map::new()));
    assert_eq!(out["isError"], true);
}

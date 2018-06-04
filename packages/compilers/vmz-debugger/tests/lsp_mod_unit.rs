//! Moved from `src/lsp/mod.rs` (cargo-cry: tests next to Cargo.toml).

use serde::Serialize;

use std::fs;
use vmz_debugger::lsp::*;

#[derive(Serialize)]
struct ExplainRequest<'a> {
    jsonrpc: &'static str,
    id: i64,
    method: &'a str,
    params: ExplainParams,
}

#[test]
fn initialize_advertises_vmz_methods() {
    let caps = initialize_result();
    assert_eq!(caps["capabilities"]["experimental"]["vmz"]["explain"], true);
}

#[test]
fn dispatch_explain_write_missing_graph() {
    let dir = std::env::temp_dir().join(format!("vmz-lsp-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let session = LspSession::new(&dir, &dir);
    let req = serde_json::to_value(ExplainRequest {
        jsonrpc: "2.0",
        id: 1,
        method: METHOD_EXPLAIN,
        params: ExplainParams { target: "write:n".into() },
    })
    .expect("request value");
    let resp = dispatch(&session, &req).expect("response");
    assert!(resp.error.is_none());
    let result = resp.result.expect("result");
    assert_eq!(result["kind"], "write");
    let _ = fs::remove_dir_all(&dir);
}

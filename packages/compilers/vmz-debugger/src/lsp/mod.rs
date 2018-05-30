//! LSP protocol surface for VMZ debugger queries.
//!
//! Standard textDocument/* sync stays thin; VMZ custom methods share the same
//! explain / trace / replay core as MCP and Workspace. Not a separate crate.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::causal_replay;

/// Custom LSP method names (JSON-RPC).
pub const METHOD_EXPLAIN: &str = "vmz/explain";
pub const METHOD_INGEST_TRACE: &str = "vmz/ingestTrace";
pub const METHOD_REPLAY_CAUSAL: &str = "vmz/replayCausal";
pub const METHOD_CHECK_X5: &str = "vmz/checkX5";

#[derive(Debug, Clone)]
pub struct LspSession {
    pub root: PathBuf,
    pub out_dir: PathBuf,
    pub generation: u64,
}

impl LspSession {
    pub fn new(root: impl Into<PathBuf>, out_dir: impl Into<PathBuf>) -> Self {
        Self { root: root.into(), out_dir: out_dir.into(), generation: 0 }
    }

    pub fn with_generation(mut self, generation: u64) -> Self {
        self.generation = generation;
        self
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainParams {
    /// `write:<field>` / `update:<chunk>#binding:<id>` (same as Workspace.explain).
    pub target: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceParams {
    /// Raw trace JSON (array or `{ schema, events }`).
    pub trace_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    pub fn err(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message: message.into(), data: None }),
        }
    }
}

/// Initialize result capabilities (VMZ custom methods advertised under experimental).
pub fn initialize_result() -> Value {
    json!({
        "capabilities": {
            "experimental": {
                "vmz": {
                    "explain": true,
                    "ingestTrace": true,
                    "replayCausal": true,
                    "checkX5": true,
                }
            }
        },
        "serverInfo": {
            "name": "vmz-debugger-lsp",
            "version": env!("CARGO_PKG_VERSION"),
        }
    })
}

pub fn handle_explain(session: &LspSession, params: &ExplainParams) -> Value {
    let target = params.target.trim();
    let doc = if let Some(spec) = target.strip_prefix("write:") {
        causal_replay::explain_write(&session.out_dir, spec, session.generation)
    } else if let Some(spec) = target.strip_prefix("update:") {
        causal_replay::explain_update(&session.out_dir, spec, session.generation)
    } else {
        causal_replay::explain_write(&session.out_dir, target, session.generation)
    };
    serde_json::from_str(&doc.to_json()).unwrap_or_else(|_| json!({ "raw": doc.to_json() }))
}

pub fn handle_ingest_trace(params: &TraceParams) -> Value {
    let doc = causal_replay::ingest_runtime_trace(&params.trace_json);
    serde_json::from_str(&doc.to_json()).unwrap_or_else(|_| json!({ "raw": doc.to_json() }))
}

pub fn handle_replay_causal(session: &LspSession, params: &TraceParams) -> Value {
    let doc =
        causal_replay::replay_causal(&session.out_dir, &params.trace_json, session.generation);
    serde_json::from_str(&doc.to_json()).unwrap_or_else(|_| json!({ "raw": doc.to_json() }))
}

pub fn handle_check_x5(session: &LspSession) -> Value {
    let doc = causal_replay::check_causal_replay(&session.out_dir, session.generation);
    serde_json::from_str(&doc.to_json()).unwrap_or_else(|_| json!({ "raw": doc.to_json() }))
}

/// Dispatch one JSON-RPC request object. Returns `None` for notifications (no id).
pub fn dispatch(session: &LspSession, request: &Value) -> Option<JsonRpcResponse> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    // Notifications have no id.
    if id.is_none() {
        return None;
    }
    let id = id.unwrap();

    match method {
        "initialize" => Some(JsonRpcResponse::ok(id, initialize_result())),
        "shutdown" => Some(JsonRpcResponse::ok(id, Value::Null)),
        METHOD_EXPLAIN => match serde_json::from_value::<ExplainParams>(params) {
            Ok(p) => Some(JsonRpcResponse::ok(id, handle_explain(session, &p))),
            Err(e) => Some(JsonRpcResponse::err(id, -32602, e.to_string())),
        },
        METHOD_INGEST_TRACE => match serde_json::from_value::<TraceParams>(params) {
            Ok(p) => Some(JsonRpcResponse::ok(id, handle_ingest_trace(&p))),
            Err(e) => Some(JsonRpcResponse::err(id, -32602, e.to_string())),
        },
        METHOD_REPLAY_CAUSAL => match serde_json::from_value::<TraceParams>(params) {
            Ok(p) => Some(JsonRpcResponse::ok(id, handle_replay_causal(session, &p))),
            Err(e) => Some(JsonRpcResponse::err(id, -32602, e.to_string())),
        },
        METHOD_CHECK_X5 => Some(JsonRpcResponse::ok(id, handle_check_x5(session))),
        "" => Some(JsonRpcResponse::err(id, -32600, "missing method")),
        other => Some(JsonRpcResponse::err(id, -32601, format!("method not found: {other}"))),
    }
}

/// Resolve default `out_dir` next to project root (`dist`).
pub fn default_out_dir(root: &Path) -> PathBuf {
    root.join("dist")
}

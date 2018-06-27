//! LSP protocol surface for VMZ debugger queries.
//!
//! Standard textDocument/* sync stays thin; VMZ custom methods share the same
//! explain / trace / replay core as MCP and Workspace. Not a separate crate.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::causal_replay;

/// JSON-RPC method name for Program Graph explain (`vmz/explain`).
pub const METHOD_EXPLAIN: &str = "vmz/explain";
/// JSON-RPC method name for runtime trace ingest (`vmz/ingestTrace`).
pub const METHOD_INGEST_TRACE: &str = "vmz/ingestTrace";
/// JSON-RPC method name for causal replay (`vmz/replayCausal`).
pub const METHOD_REPLAY_CAUSAL: &str = "vmz/replayCausal";
/// JSON-RPC method name for the umbrella causal replay check (`vmz/checkX5`).
pub const METHOD_CHECK_X5: &str = "vmz/checkX5";

/// Workspace paths and session generation for one LSP client connection.
#[derive(Debug, Clone)]
pub struct LspSession {
    /// Project root directory supplied at session start.
    pub root: PathBuf,
    /// Build output directory that holds `*.program.json` artifacts (often `dist`).
    pub out_dir: PathBuf,
    /// Monotonic session generation stamped onto explain / replay documents.
    pub generation: u64,
}

impl LspSession {
    /// Create a session with `generation` set to `0`.
    pub fn new(root: impl Into<PathBuf>, out_dir: impl Into<PathBuf>) -> Self {
        Self { root: root.into(), out_dir: out_dir.into(), generation: 0 }
    }

    /// Override the session generation used by explain and replay handlers.
    pub fn with_generation(mut self, generation: u64) -> Self {
        self.generation = generation;
        self
    }
}

/// Parameters for [`METHOD_EXPLAIN`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainParams {
    /// Target selector: `write:<field>` or `update:<chunk>#binding:<id>`.
    pub target: String,
}

/// Parameters for ingest and causal replay methods that accept a trace payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceParams {
    /// Raw trace JSON (event array or `{ schema, events }`).
    pub trace_json: String,
}

/// JSON-RPC 2.0 error object returned when a request fails.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcError {
    /// Numeric error code (JSON-RPC reserved or application-specific).
    pub code: i64,
    /// Human-readable error description.
    pub message: String,
    /// Optional structured details omitted when `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// JSON-RPC 2.0 response envelope for a successful or failed request.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcResponse {
    /// Protocol version string; always `"2.0"`.
    pub jsonrpc: &'static str,
    /// Request id echoed from the inbound message.
    pub id: Value,
    /// Successful result payload; absent on error responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Error object; absent on successful responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    /// Build a successful response with the given `result` value.
    pub fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    /// Build an error response with no `data` payload.
    pub fn err(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message: message.into(), data: None }),
        }
    }
}

/// VMZ-specific experimental capability flags advertised on initialize.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VmzExperimental {
    /// `vmz/explain` is available.
    pub explain: bool,
    /// `vmz/ingestTrace` is available.
    pub ingest_trace: bool,
    /// `vmz/replayCausal` is available.
    pub replay_causal: bool,
    /// `vmz/checkX5` (umbrella causal replay check) is available.
    pub check_x5: bool,
}

/// Nested `experimental` object that holds the VMZ capability block.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentalCapabilities {
    /// VMZ debugger method capability flags.
    pub vmz: VmzExperimental,
}

/// LSP server capabilities returned from `initialize`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    /// Experimental capabilities, including the VMZ method flags.
    pub experimental: ExperimentalCapabilities,
}

/// Static server identity returned in the initialize result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    /// Server product name (for example `vmz-debugger-lsp`).
    pub name: &'static str,
    /// Crate version from `CARGO_PKG_VERSION`.
    pub version: &'static str,
}

/// Typed LSP initialize result (serialized for JSON-RPC `result`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    /// Advertised server capabilities.
    pub capabilities: ServerCapabilities,
    /// Server name and version.
    pub server_info: ServerInfo,
}

fn to_rpc_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// Build initialize `result` as JSON `Value` for the JSON-RPC envelope.
pub fn initialize_result() -> Value {
    to_rpc_value(&InitializeResult {
        capabilities: ServerCapabilities {
            experimental: ExperimentalCapabilities {
                vmz: VmzExperimental {
                    explain: true,
                    ingest_trace: true,
                    replay_causal: true,
                    check_x5: true,
                },
            },
        },
        server_info: ServerInfo { name: "vmz-debugger-lsp", version: env!("CARGO_PKG_VERSION") },
    })
}

/// Handle `vmz/explain`: resolve `write:` / `update:` targets via Program Graph.
pub fn handle_explain(session: &LspSession, params: &ExplainParams) -> Value {
    let target = params.target.trim();
    let doc = if let Some(spec) = target.strip_prefix("write:") {
        causal_replay::explain_write(&session.out_dir, spec, session.generation)
    } else if let Some(spec) = target.strip_prefix("update:") {
        causal_replay::explain_update(&session.out_dir, spec, session.generation)
    } else {
        causal_replay::explain_write(&session.out_dir, target, session.generation)
    };
    to_rpc_value(&doc)
}

/// Handle `vmz/ingestTrace`: validate and normalize the inbound trace JSON.
pub fn handle_ingest_trace(params: &TraceParams) -> Value {
    let doc = causal_replay::ingest_runtime_trace(&params.trace_json);
    to_rpc_value(&doc)
}

/// Handle `vmz/replayCausal`: join trace events to explain chains under `out_dir`.
pub fn handle_replay_causal(session: &LspSession, params: &TraceParams) -> Value {
    let doc =
        causal_replay::replay_causal(&session.out_dir, &params.trace_json, session.generation);
    to_rpc_value(&doc)
}

/// Handle `vmz/checkX5`: run the umbrella causal replay check on deployment artifacts.
pub fn handle_check_x5(session: &LspSession) -> Value {
    let doc = causal_replay::check_causal_replay(&session.out_dir, session.generation);
    to_rpc_value(&doc)
}

/// Dispatch one JSON-RPC request object. Returns `None` for notifications (no id).
pub fn dispatch(session: &LspSession, request: &Value) -> Option<JsonRpcResponse> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    // Notifications have no id.
    let id = id?;

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

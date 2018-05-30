//! MCP protocol surface for VMZ debugger tools.
//!
//! Tool handlers share explain / trace / replay with [`crate::lsp`]. Not a separate crate.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::causal_replay;

pub const PROTOCOL_VERSION: &str = "2024-11-05";

pub const TOOL_EXPLAIN: &str = "vmz_explain";
pub const TOOL_INGEST_TRACE: &str = "vmz_ingest_trace";
pub const TOOL_REPLAY_CAUSAL: &str = "vmz_replay_causal";
pub const TOOL_CHECK_X5: &str = "vmz_check_x5";

#[derive(Debug, Clone)]
pub struct McpSession {
    pub root: PathBuf,
    pub out_dir: PathBuf,
    pub generation: u64,
}

impl McpSession {
    pub fn new(root: impl Into<PathBuf>, out_dir: impl Into<PathBuf>) -> Self {
        Self { root: root.into(), out_dir: out_dir.into(), generation: 0 }
    }

    pub fn with_generation(mut self, generation: u64) -> Self {
        self.generation = generation;
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDesc {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// MCP `tools/list` catalog (debugger-owned tools only).
pub fn list_tools() -> Vec<ToolDesc> {
    vec![
        ToolDesc {
            name: TOOL_EXPLAIN.into(),
            description:
                "Explain write/update via Program Graph StableId chain (vmz.dx.explain.v0)".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "write:<field> | update:<chunk>#binding:<id>"
                    }
                },
                "required": ["target"]
            }),
        },
        ToolDesc {
            name: TOOL_INGEST_TRACE.into(),
            description: "Ingest StableId runtime/synthetic trace (vmz.dx.trace.v0)".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "traceJson": { "type": "string" }
                },
                "required": ["traceJson"]
            }),
        },
        ToolDesc {
            name: TOOL_REPLAY_CAUSAL.into(),
            description: "Join trace events to explain chains (vmz.dx.causal_replay.v0)".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "traceJson": { "type": "string" }
                },
                "required": ["traceJson"]
            }),
        },
        ToolDesc {
            name: TOOL_CHECK_X5.into(),
            description: "Umbrella deep-explain report (vmz.dx.causal_replay_check.v0)".into(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

pub fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "vmz-debugger-mcp",
            "version": env!("CARGO_PKG_VERSION"),
        }
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExplainArgs {
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceArgs {
    trace_json: String,
}

fn text_content(body: Value) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": body.to_string()
        }],
        "structuredContent": body,
        "isError": false
    })
}

fn error_content(message: impl Into<String>) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": message.into()
        }],
        "isError": true
    })
}

pub fn call_tool(session: &McpSession, name: &str, arguments: Value) -> Value {
    match name {
        TOOL_EXPLAIN => {
            let Ok(args) = serde_json::from_value::<ExplainArgs>(arguments) else {
                return error_content("invalid arguments: need { target }");
            };
            let target = args.target.trim();
            let doc = if let Some(spec) = target.strip_prefix("write:") {
                causal_replay::explain_write(&session.out_dir, spec, session.generation)
            } else if let Some(spec) = target.strip_prefix("update:") {
                causal_replay::explain_update(&session.out_dir, spec, session.generation)
            } else {
                causal_replay::explain_write(&session.out_dir, target, session.generation)
            };
            let body = serde_json::from_str(&doc.to_json())
                .unwrap_or_else(|_| json!({ "raw": doc.to_json() }));
            text_content(body)
        }
        TOOL_INGEST_TRACE => {
            let Ok(args) = serde_json::from_value::<TraceArgs>(arguments) else {
                return error_content("invalid arguments: need { traceJson }");
            };
            let doc = causal_replay::ingest_runtime_trace(&args.trace_json);
            let body = serde_json::from_str(&doc.to_json())
                .unwrap_or_else(|_| json!({ "raw": doc.to_json() }));
            text_content(body)
        }
        TOOL_REPLAY_CAUSAL => {
            let Ok(args) = serde_json::from_value::<TraceArgs>(arguments) else {
                return error_content("invalid arguments: need { traceJson }");
            };
            let doc = causal_replay::replay_causal(
                &session.out_dir,
                &args.trace_json,
                session.generation,
            );
            let body = serde_json::from_str(&doc.to_json())
                .unwrap_or_else(|_| json!({ "raw": doc.to_json() }));
            text_content(body)
        }
        TOOL_CHECK_X5 => {
            let doc = causal_replay::check_causal_replay(&session.out_dir, session.generation);
            let body = serde_json::from_str(&doc.to_json())
                .unwrap_or_else(|_| json!({ "raw": doc.to_json() }));
            text_content(body)
        }
        other => error_content(format!("unknown tool: {other}")),
    }
}

/// Dispatch MCP JSON-RPC-shaped request (`initialize` / `tools/list` / `tools/call`).
pub fn dispatch(session: &McpSession, request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    if id.is_none() {
        return None;
    }
    let id = id.unwrap();

    let result = match method {
        "initialize" => initialize_result(),
        "tools/list" => json!({ "tools": list_tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            call_tool(session, name, args)
        }
        "ping" => json!({}),
        other => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("method not found: {other}") }
            }));
        }
    };

    Some(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
}

pub fn default_out_dir(root: &Path) -> PathBuf {
    root.join("dist")
}

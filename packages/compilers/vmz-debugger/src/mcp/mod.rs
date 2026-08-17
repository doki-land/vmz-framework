//! MCP protocol surface for VMZ debugger tools.
//!
//! Tool handlers share explain / trace / replay with [`crate::lsp`]. Not a separate crate.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::causal_replay;

/// Declared MCP protocol version string returned from `initialize`.
pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// MCP tool name for Program Graph explain.
pub const TOOL_EXPLAIN: &str = "vmz_explain";
/// MCP tool name for runtime trace ingest.
pub const TOOL_INGEST_TRACE: &str = "vmz_ingest_trace";
/// MCP tool name for causal replay.
pub const TOOL_REPLAY_CAUSAL: &str = "vmz_replay_causal";
/// MCP tool name for the umbrella causal replay check.
pub const TOOL_CHECK_X5: &str = "vmz_check_x5";

/// Workspace paths and session generation for one MCP client connection.
#[derive(Debug, Clone)]
pub struct McpSession {
    /// Project root directory supplied at session start.
    pub root: PathBuf,
    /// Build output directory that holds `*.program.json` artifacts (often `dist`).
    pub out_dir: PathBuf,
    /// Monotonic session generation stamped onto explain / replay documents.
    pub generation: u64,
}

impl McpSession {
    /// Create a session with `generation` set to `0`.
    pub fn new(root: impl Into<PathBuf>, out_dir: impl Into<PathBuf>) -> Self {
        Self { root: root.into(), out_dir: out_dir.into(), generation: 0 }
    }

    /// Override the session generation used by tool handlers.
    pub fn with_generation(mut self, generation: u64) -> Self {
        self.generation = generation;
        self
    }
}

/// JSON Schema property fragment for MCP `inputSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct JsonSchemaProperty {
    /// JSON Schema `type` for this property (for example `"string"`).
    #[serde(rename = "type")]
    pub prop_type: &'static str,
    /// Optional human-readable description shown to MCP clients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'static str>,
}

/// JSON Schema object fragment for MCP tool `inputSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct JsonSchemaObject {
    /// JSON Schema `type` for the root object (always `"object"` here).
    #[serde(rename = "type")]
    pub schema_type: &'static str,
    /// Named properties accepted by the tool.
    pub properties: BTreeMap<&'static str, JsonSchemaProperty>,
    /// Required property names; omitted from JSON when `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<&'static str>>,
}

/// One tool entry returned by MCP `tools/list`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDesc {
    /// Tool identifier passed to `tools/call`.
    pub name: String,
    /// Short description of what the tool does.
    pub description: String,
    /// JSON Schema describing the tool arguments.
    pub input_schema: JsonSchemaObject,
}

fn string_prop(description: Option<&'static str>) -> JsonSchemaProperty {
    JsonSchemaProperty { prop_type: "string", description }
}

fn object_schema(
    properties: BTreeMap<&'static str, JsonSchemaProperty>,
    required: Option<Vec<&'static str>>,
) -> JsonSchemaObject {
    JsonSchemaObject { schema_type: "object", properties, required }
}

/// MCP `tools/list` catalog (debugger-owned tools only).
pub fn list_tools() -> Vec<ToolDesc> {
    vec![
        ToolDesc {
            name: TOOL_EXPLAIN.into(),
            description:
                "Explain write/update via Program Graph StableId chain (vmz.dx.explain.v0)".into(),
            input_schema: object_schema(
                BTreeMap::from([(
                    "target",
                    string_prop(Some("write:<field> | update:<chunk>#binding:<id>")),
                )]),
                Some(vec!["target"]),
            ),
        },
        ToolDesc {
            name: TOOL_INGEST_TRACE.into(),
            description: "Ingest StableId runtime/synthetic trace (vmz.dx.trace.v0)".into(),
            input_schema: object_schema(
                BTreeMap::from([("traceJson", string_prop(None))]),
                Some(vec!["traceJson"]),
            ),
        },
        ToolDesc {
            name: TOOL_REPLAY_CAUSAL.into(),
            description: "Join trace events to explain chains (vmz.dx.causal_replay.v0)".into(),
            input_schema: object_schema(
                BTreeMap::from([("traceJson", string_prop(None))]),
                Some(vec!["traceJson"]),
            ),
        },
        ToolDesc {
            name: TOOL_CHECK_X5.into(),
            description: "Umbrella causal replay check report (vmz.dx.causal_replay_check.v0)"
                .into(),
            input_schema: object_schema(BTreeMap::new(), None),
        },
    ]
}

#[derive(Debug, Serialize)]
struct EmptyObject {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolsCapability {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpCapabilities {
    tools: McpToolsCapability,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    name: &'static str,
    version: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpInitializeResult {
    protocol_version: &'static str,
    capabilities: McpCapabilities,
    server_info: ServerInfo,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolsListResult {
    tools: Vec<ToolDesc>,
}

#[derive(Debug, Serialize)]
struct TextContentPart {
    #[serde(rename = "type")]
    part_type: &'static str,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolSuccessResult {
    content: Vec<TextContentPart>,
    structured_content: Value,
    is_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolErrorResult {
    content: Vec<TextContentPart>,
    is_error: bool,
}

#[derive(Debug, Serialize)]
struct JsonRpcErrorBody {
    code: i64,
    message: String,
}

#[derive(Debug, Serialize)]
struct JsonRpcOkEnvelope {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcErrEnvelope {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcErrorBody,
}

fn to_rpc_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// Build the MCP `initialize` result (protocol version, tools capability, server info).
pub fn initialize_result() -> Value {
    to_rpc_value(&McpInitializeResult {
        protocol_version: PROTOCOL_VERSION,
        capabilities: McpCapabilities { tools: McpToolsCapability {} },
        server_info: ServerInfo { name: "vmz-debugger-mcp", version: env!("CARGO_PKG_VERSION") },
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
    to_rpc_value(&ToolSuccessResult {
        content: vec![TextContentPart { part_type: "text", text: body.to_string() }],
        structured_content: body,
        is_error: false,
    })
}

fn error_content(message: impl Into<String>) -> Value {
    to_rpc_value(&ToolErrorResult {
        content: vec![TextContentPart { part_type: "text", text: message.into() }],
        is_error: true,
    })
}

/// Invoke one debugger tool by name with JSON `arguments`; returns MCP tool result JSON.
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
            text_content(to_rpc_value(&doc))
        }
        TOOL_INGEST_TRACE => {
            let Ok(args) = serde_json::from_value::<TraceArgs>(arguments) else {
                return error_content("invalid arguments: need { traceJson }");
            };
            let doc = causal_replay::ingest_runtime_trace(&args.trace_json);
            text_content(to_rpc_value(&doc))
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
            text_content(to_rpc_value(&doc))
        }
        TOOL_CHECK_X5 => {
            let doc = causal_replay::check_causal_replay(&session.out_dir, session.generation);
            text_content(to_rpc_value(&doc))
        }
        other => error_content(format!("unknown tool: {other}")),
    }
}

/// Dispatch MCP JSON-RPC-shaped request (`initialize` / `tools/list` / `tools/call`).
pub fn dispatch(session: &McpSession, request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    let id = id?;

    let result = match method {
        "initialize" => initialize_result(),
        "tools/list" => to_rpc_value(&ToolsListResult { tools: list_tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
            call_tool(session, name, args)
        }
        "ping" => to_rpc_value(&EmptyObject {}),
        other => {
            return Some(to_rpc_value(&JsonRpcErrEnvelope {
                jsonrpc: "2.0",
                id,
                error: JsonRpcErrorBody {
                    code: -32601,
                    message: format!("method not found: {other}"),
                },
            }));
        }
    };

    Some(to_rpc_value(&JsonRpcOkEnvelope { jsonrpc: "2.0", id, result }))
}

/// Resolve default `out_dir` next to project root (`dist`).
pub fn default_out_dir(root: &Path) -> PathBuf {
    root.join("dist")
}

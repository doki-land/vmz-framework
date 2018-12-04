//! ServerArtifact normalize — route decision tree, HTTP contract digests, adapters.
//!
//! Mirrors the historical TS assembler in `@vmz/vmz` (`emitServerArtifact`); hosts
//! only read / write files and call N-API.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::error::ArtifactError;

/// Wire schema for `server-artifact.json`.
pub const SERVER_ARTIFACT_SCHEMA: &str = "vmz.server.artifact.v0";
/// Wire schema for the embedded HTTP contract digest payload.
pub const HTTP_CONTRACT_SCHEMA: &str = "vmz.http.contract.v0";
/// Wire schema for projected runtime adapter documents.
pub const SERVER_RUNTIME_ADAPTER_SCHEMA: &str = "vmz.server.runtime_adapter.v0";

const DEFAULT_RPC_PATH: &str = "/__vmz/rpc";

/// Closed server runtime whitelist (parity with TS `SERVER_RUNTIMES`).
pub const SERVER_RUNTIMES: &[&str] = &["node", "worker", "deno", "bun", "rust-host"];

/// Optional fields when normalizing a ServerArtifact.
#[derive(Debug, Clone, Default)]
pub struct ServerArtifactOpts {
    /// Delivery profile id.
    pub profile_id: Option<String>,
    /// Assembly id under the profile.
    pub assembly: Option<String>,
    /// Selected server runtime (`node` / `worker` / …).
    pub server_runtime: Option<String>,
    /// Optional pack digest from release packing.
    pub pack_digest: Option<String>,
}

/// Normalize deployment + routes JSON into a ServerArtifact document value.
pub fn normalize_server_artifact(
    deployment_json: &str,
    routes_json: &str,
    opts: &ServerArtifactOpts,
) -> Result<Value, ArtifactError> {
    let deployment: Value = if deployment_json.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(deployment_json).unwrap_or(Value::Null)
    };
    let routes: Value = if routes_json.trim().is_empty() {
        Value::Array(vec![])
    } else {
        serde_json::from_str(routes_json).unwrap_or(Value::Array(vec![]))
    };

    let deployment_obj = match &deployment {
        Value::Object(m) => m.clone(),
        _ => {
            let mut m = Map::new();
            m.insert("schema".into(), Value::Null);
            m.insert("units".into(), Value::Array(vec![]));
            m
        }
    };

    let route_rows = match &routes {
        Value::Array(a) => a.clone(),
        _ => vec![],
    };

    let selected_runtime = normalize_runtime(opts.server_runtime.as_deref());
    let units = match deployment_obj.get("units") {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    };

    let mut public_routes: Vec<Value> = Vec::new();
    for r in &route_rows {
        let verb = str_field(r, "verb", "GET").to_uppercase();
        let path = str_field(r, "path", "");
        let module_id = str_field(r, "moduleId", "");
        let method = str_field(r, "method", "");
        let class_name = match r.get("className") {
            Some(Value::Null) | None => Value::Null,
            Some(v) => Value::String(v.as_str().unwrap_or("").to_string()),
        };
        public_routes.push(json_obj(&[
            ("verb", Value::String(verb)),
            ("path", Value::String(path)),
            ("moduleId", Value::String(module_id)),
            ("method", Value::String(method)),
            ("className", class_name),
            ("visibility", Value::String("public".into())),
            ("kind", Value::String("server-route".into())),
        ]));
    }

    let public_keys: std::collections::HashSet<String> = public_routes
        .iter()
        .map(|r| format!("{}::{}", str_field(r, "moduleId", ""), str_field(r, "method", "")))
        .collect();

    let mut internal_capabilities: Vec<Value> = Vec::new();
    for u in &units {
        let module_id = match u.get("serverModuleId") {
            Some(Value::Null) | None => String::new(),
            Some(v) => v.as_str().unwrap_or("").to_string(),
        };
        if module_id.is_empty() {
            continue;
        }
        let caps: Vec<String> = match u.get("capabilities") {
            Some(Value::Array(a)) => a.iter().map(|c| c.as_str().unwrap_or("").to_string()).collect(),
            _ => vec![],
        };
        let chunk_id = str_field(u, "chunkId", "");
        for method in caps {
            let key = format!("{module_id}::{method}");
            if public_keys.contains(&key) {
                continue;
            }
            internal_capabilities.push(json_obj(&[
                ("chunkId", Value::String(chunk_id.clone())),
                ("moduleId", Value::String(module_id.clone())),
                ("method", Value::String(method)),
                ("visibility", Value::String("internal".into())),
                ("kind", Value::String("capability".into())),
            ]));
        }
    }

    let mut route_decision_tree: Vec<Value> = vec![json_obj(&[
        ("id", Value::String("rpc".into())),
        (
            "match",
            json_obj(&[
                ("method", Value::String("POST".into())),
                ("path", Value::String(DEFAULT_RPC_PATH.into())),
            ]),
        ),
        ("action", Value::String("invoke-rpc".into())),
        ("visibility", Value::String("internal-transport".into())),
    ])];
    for (i, r) in public_routes.iter().enumerate() {
        route_decision_tree.push(json_obj(&[
            ("id", Value::String(format!("public-route-{i}"))),
            (
                "match",
                json_obj(&[
                    ("method", Value::String(str_field(r, "verb", "GET"))),
                    ("path", Value::String(str_field(r, "path", ""))),
                ]),
            ),
            ("action", Value::String("invoke-server-route".into())),
            (
                "target",
                json_obj(&[
                    ("moduleId", Value::String(str_field(r, "moduleId", ""))),
                    ("method", Value::String(str_field(r, "method", ""))),
                ]),
            ),
            ("visibility", Value::String("public".into())),
        ]));
    }

    let http_public: Vec<Value> = public_routes
        .iter()
        .map(|r| {
            json_obj(&[
                ("verb", Value::String(str_field(r, "verb", "GET"))),
                ("path", Value::String(str_field(r, "path", ""))),
                ("moduleId", Value::String(str_field(r, "moduleId", ""))),
                ("method", Value::String(str_field(r, "method", ""))),
            ])
        })
        .collect();

    let http_contract_body = json_obj(&[
        ("schema", Value::String(HTTP_CONTRACT_SCHEMA.into())),
        ("rpcPath", Value::String(DEFAULT_RPC_PATH.into())),
        ("publicRoutes", Value::Array(http_public)),
        ("internalCapabilityCount", Value::Number(internal_capabilities.len().into())),
        ("entry", Value::String("fetch".into())),
    ]);
    let http_contract_digest = sha256_hex(&canonical_json(&http_contract_body));

    let adapters = json_obj(&[
        (
            "node",
            json_obj(&[
                ("kind", Value::String("node-http".into())),
                ("status", Value::String("runtime".into())),
                ("entry", Value::String("handleNodeRequest".into())),
            ]),
        ),
        (
            "worker",
            json_obj(&[
                ("kind", Value::String("fetch".into())),
                ("status", Value::String("runtime".into())),
                ("entry", Value::String("handleFetchRequest".into())),
            ]),
        ),
        (
            "deno",
            json_obj(&[
                ("kind", Value::String("fetch".into())),
                ("status", Value::String("projected".into())),
                ("entry", Value::String("handleFetchRequest".into())),
            ]),
        ),
        (
            "bun",
            json_obj(&[
                ("kind", Value::String("fetch".into())),
                ("status", Value::String("projected".into())),
                ("entry", Value::String("handleFetchRequest".into())),
            ]),
        ),
        (
            "rust-host",
            json_obj(&[
                ("kind", Value::String("contract-projection".into())),
                ("status", Value::String("projected".into())),
                ("entry", Value::String("fetch".into())),
            ]),
        ),
    ]);

    let deployment_schema = deployment_obj.get("schema").cloned().unwrap_or(Value::Null);

    let mut artifact = json_obj(&[
        ("schema", Value::String(SERVER_ARTIFACT_SCHEMA.into())),
        ("profileId", opt_string_or_null(opts.profile_id.as_deref())),
        ("assembly", opt_string_or_null(opts.assembly.as_deref())),
        ("selectedRuntime", Value::String(selected_runtime)),
        (
            "entry",
            json_obj(&[
                ("kind", Value::String("fetch".into())),
                (
                    "standards",
                    Value::Array(vec![
                        Value::String("Request".into()),
                        Value::String("Response".into()),
                        Value::String("Streams".into()),
                        Value::String("AbortSignal".into()),
                    ]),
                ),
                ("rpcPath", Value::String(DEFAULT_RPC_PATH.into())),
            ]),
        ),
        (
            "httpContract",
            json_obj(&[
                ("schema", Value::String(HTTP_CONTRACT_SCHEMA.into())),
                ("digest", Value::String(http_contract_digest)),
            ]),
        ),
        ("publicRoutes", Value::Array(public_routes)),
        ("internalCapabilities", Value::Array(internal_capabilities)),
        ("middlewareUnits", Value::Array(vec![])),
        ("routeDecisionTree", Value::Array(route_decision_tree)),
        ("deploymentSchema", deployment_schema),
        ("packDigest", opt_string_or_null(opts.pack_digest.as_deref())),
        ("adapters", adapters),
    ]);

    let artifact_digest = sha256_hex(&canonical_json(&artifact));
    if let Value::Object(ref mut m) = artifact {
        m.insert("artifactDigest".into(), Value::String(artifact_digest));
    }

    Ok(artifact)
}

/// Normalize and serialize ServerArtifact as a JSON string.
pub fn normalize_server_artifact_json(
    deployment_json: &str,
    routes_json: &str,
    opts: &ServerArtifactOpts,
) -> Result<String, ArtifactError> {
    let artifact = normalize_server_artifact(deployment_json, routes_json, opts)?;
    Ok(serde_json::to_string(&artifact)?)
}

/// Project a runtime adapter document from a normalized ServerArtifact value.
pub fn project_server_runtime_adapter(
    artifact: &Value,
    adapter_id: &str,
) -> Result<Value, ArtifactError> {
    let id = adapter_id.trim();
    if !SERVER_RUNTIMES.contains(&id) && id != "worker" {
        return Err(ArtifactError::Message(format!(
            "projectServerRuntimeAdapter: unknown adapter {id}"
        )));
    }

    let artifact_digest = artifact.get("artifactDigest").cloned().unwrap_or(Value::Null);
    let http_digest = artifact
        .pointer("/httpContract/digest")
        .cloned()
        .unwrap_or(Value::Null);
    let public_count = match artifact.get("publicRoutes") {
        Some(Value::Array(a)) => a.len(),
        _ => 0,
    };
    let internal_count = match artifact.get("internalCapabilities") {
        Some(Value::Array(a)) => a.len(),
        _ => 0,
    };
    let entry = artifact.get("entry").cloned().unwrap_or(Value::Null);

    let mut base = json_obj(&[
        ("schema", Value::String(SERVER_RUNTIME_ADAPTER_SCHEMA.into())),
        ("adapterId", Value::String(id.into())),
        ("artifactDigest", artifact_digest),
        ("httpContractDigest", http_digest),
        ("spaFallback", Value::Bool(false)),
        ("entry", entry),
        ("publicRouteCount", Value::Number(public_count.into())),
        ("internalCapabilityCount", Value::Number(internal_count.into())),
    ]);

    let extra = if id == "node" {
        json_obj(&[
            ("host", Value::String("node:http".into())),
            ("invoke", Value::String("handleNodeRequest".into())),
            ("status", Value::String("runtime".into())),
        ])
    } else if id == "worker" || id == "deno" || id == "bun" {
        let note = if id == "worker" {
            "Fetch entry; live thin gated via worker-shaped subprocess host"
        } else {
            "Fetch contract projection; live runtime not gated"
        };
        let status = if id == "worker" { "runtime" } else { "projected" };
        json_obj(&[
            ("host", Value::String("fetch".into())),
            ("invoke", Value::String("handleFetchRequest".into())),
            ("status", Value::String(status.into())),
            ("note", Value::String(note.into())),
        ])
    } else {
        // rust-host
        json_obj(&[
            ("host", Value::String("rust-fetch-consumer".into())),
            ("invoke", Value::String("fetch".into())),
            ("status", Value::String("projected".into())),
            (
                "note",
                Value::String(
                    "contract projection only — live Rust host binary parity not gated".into(),
                ),
            ),
            (
                "consumes",
                Value::Array(vec![
                    Value::String("server-artifact.json".into()),
                    Value::String("vmz-routes.json".into()),
                    Value::String("vmz-deployment.json".into()),
                ]),
            ),
        ])
    };

    if let (Value::Object(base_m), Value::Object(extra_m)) = (&mut base, extra) {
        for (k, v) in extra_m {
            base_m.insert(k, v);
        }
    }

    Ok(base)
}

/// Project adapter and serialize as JSON string.
pub fn project_server_runtime_adapter_json(
    artifact_json: &str,
    adapter_id: &str,
) -> Result<String, ArtifactError> {
    let artifact: Value = serde_json::from_str(artifact_json)?;
    let projection = project_server_runtime_adapter(&artifact, adapter_id)?;
    Ok(serde_json::to_string(&projection)?)
}

fn normalize_runtime(raw: Option<&str>) -> String {
    let v = raw.unwrap_or("node").trim();
    if SERVER_RUNTIMES.contains(&v) {
        v.to_string()
    } else {
        "node".into()
    }
}

fn str_field(v: &Value, key: &str, default: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.as_str().unwrap_or(default).to_string(),
        None => default.to_string(),
    }
}

fn opt_string_or_null(v: Option<&str>) -> Value {
    match v {
        Some(s) if !s.is_empty() => Value::String(s.to_string()),
        _ => Value::Null,
    }
}

fn json_obj(entries: &[(&str, Value)]) -> Value {
    let mut m = Map::new();
    for (k, v) in entries {
        m.insert((*k).into(), v.clone());
    }
    Value::Object(m)
}

/// Recursively sort object keys (parity with TS `sortKeys` + `JSON.stringify`).
pub fn sort_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = Map::new();
            for k in keys {
                out.insert(k.clone(), sort_keys(&map[k]));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_keys).collect()),
        other => other.clone(),
    }
}

/// Compact JSON with recursively sorted object keys.
pub fn canonical_json(value: &Value) -> String {
    serde_json::to_string(&sort_keys(value)).expect("canonical json serialize")
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let dig = hasher.finalize();
    let mut out = String::with_capacity(dig.len() * 2);
    for b in dig {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Typed public-route row (documentation / tests).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicRouteWire {
    /// HTTP verb.
    pub verb: String,
    /// Route path.
    pub path: String,
    /// Server module id.
    pub module_id: String,
    /// Method name.
    pub method: String,
    /// Optional class name.
    pub class_name: Option<String>,
    /// Always `public`.
    pub visibility: String,
    /// Always `server-route`.
    pub kind: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_inputs_produce_artifact_digest() {
        let art = normalize_server_artifact("{}", "[]", &ServerArtifactOpts::default()).expect("ok");
        assert_eq!(art["schema"], SERVER_ARTIFACT_SCHEMA);
        assert_eq!(art["selectedRuntime"], "node");
        assert!(art["artifactDigest"].as_str().unwrap().len() == 64);
        assert_eq!(art["routeDecisionTree"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn public_and_internal_split() {
        let deployment = r##"{
          "schema": "vmz.deployment.v0",
          "units": [{
            "chunkId": "pages/x",
            "kind": "page",
            "serverModuleId": "#server/pages/x",
            "capabilities": ["publicFn", "secretFn"]
          }]
        }"##;
        let routes = r##"[{
          "verb": "get",
          "path": "/api/x",
          "moduleId": "#server/pages/x",
          "method": "publicFn"
        }]"##;
        let art = normalize_server_artifact(deployment, routes, &ServerArtifactOpts::default())
            .expect("ok");
        assert_eq!(art["publicRoutes"].as_array().unwrap().len(), 1);
        let internals = art["internalCapabilities"].as_array().unwrap();
        assert_eq!(internals.len(), 1);
        assert_eq!(internals[0]["method"], "secretFn");
    }

    #[test]
    fn adapter_projection_worker() {
        let art = normalize_server_artifact("{}", "[]", &ServerArtifactOpts::default()).expect("ok");
        let proj = project_server_runtime_adapter(&art, "worker").expect("proj");
        assert_eq!(proj["schema"], SERVER_RUNTIME_ADAPTER_SCHEMA);
        assert_eq!(proj["host"], "fetch");
        assert_eq!(proj["status"], "runtime");
    }
}

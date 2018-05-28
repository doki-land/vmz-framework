//! X4 DX: end-to-end deployment schema proofs from `vmz-deployment.json`.
//!
//! Design: `规划设计/vmz/21` §10 X4.
//!
//! Algebraic proofs over deployment units:
//! - boundary validators (route / resume / rpc / action)
//! - client/server leakage
//! - capability → target (v0: `node` | `unbound`)
//! - dead graph (BFS from page/app roots via `dependsOn`)

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BOUNDARY_VALIDATOR_SCHEMA: &str = "vmz.dx.boundary_validator.v0";
pub const LEAKAGE_SCHEMA: &str = "vmz.dx.leakage.v0";
pub const CAPABILITY_TARGET_SCHEMA: &str = "vmz.dx.capability_target.v0";
pub const DEAD_GRAPH_SCHEMA: &str = "vmz.dx.dead_graph.v0";
pub const X4_CHECK_SCHEMA: &str = "vmz.dx.x4_check.v0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoundaryValidatorEntry {
    /// `route` | `resume` | `rpc` | `action`
    pub kind: String,
    pub id: String,
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoundaryValidatorDocument {
    pub schema: String,
    pub validators: Vec<BoundaryValidatorEntry>,
    /// `ready` | `empty`
    pub status: String,
}

impl BoundaryValidatorDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LeakageFinding {
    /// `capability_without_server` | `unknown_client_call`
    pub kind: String,
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LeakageDocument {
    pub schema: String,
    pub findings: Vec<LeakageFinding>,
    /// `ready` (clean) | `failed` (findings) | `empty` (no deployment)
    pub status: String,
}

impl LeakageDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityTargetEntry {
    pub capability: String,
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    /// v0: `node` if `serverModuleId` present, else `unbound`
    pub target: String,
    #[serde(rename = "serverModuleId", default, skip_serializing_if = "Option::is_none")]
    pub server_module_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityTargetConflict {
    pub capability: String,
    pub targets: Vec<String>,
    #[serde(rename = "chunkIds")]
    pub chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityTargetDocument {
    pub schema: String,
    pub targets: Vec<CapabilityTargetEntry>,
    pub conflicts: Vec<CapabilityTargetConflict>,
    /// `ready` | `failed` | `empty`
    pub status: String,
}

impl CapabilityTargetDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeadGraphDocument {
    pub schema: String,
    pub roots: Vec<String>,
    pub reachable: Vec<String>,
    #[serde(rename = "deadChunks")]
    pub dead_chunks: Vec<String>,
    #[serde(rename = "unreferencedCapabilities")]
    pub unreferenced_capabilities: Vec<String>,
    /// `ready` | `empty`
    pub status: String,
}

impl DeadGraphDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct X4CheckReport {
    pub schema: String,
    pub boundary: BoundaryValidatorDocument,
    pub leakage: LeakageDocument,
    #[serde(rename = "capabilityTargets")]
    pub capability_targets: CapabilityTargetDocument,
    #[serde(rename = "deadGraph")]
    pub dead_graph: DeadGraphDocument,
    /// `ready` | `failed` | `empty`
    pub status: String,
}

impl X4CheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone)]
struct DepUnit {
    chunk_id: String,
    kind: String,
    depends_on: Vec<String>,
    capabilities: Vec<String>,
    server_module_id: Option<String>,
    client_calls: Vec<String>,
    resume_entries: Vec<(String, String)>,
}

fn load_deployment_units(out_dir: &Path) -> Option<Vec<DepUnit>> {
    let path = out_dir.join("vmz-deployment.json");
    let text = fs::read_to_string(path).ok()?;
    let root: Value = serde_json::from_str(&text).ok()?;
    let units = root.get("units")?.as_array()?;
    let mut out = Vec::new();
    for item in units {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(chunk_id) = obj.get("chunkId").and_then(|v| v.as_str()).map(str::to_string) else {
            continue;
        };
        let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let depends_on = string_array(obj.get("dependsOn"));
        let capabilities = string_array(obj.get("capabilities"));
        let server_module_id =
            obj.get("serverModuleId").and_then(|v| v.as_str()).map(str::to_string);
        let client_calls = obj
            .get("clientCalls")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("method").and_then(|m| m.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let resume_entries = obj
            .get("resumeEntries")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| {
                        let component = r.get("component")?.as_str()?.to_string();
                        let strategy = r.get("strategy")?.as_str()?.to_string();
                        Some((component, strategy))
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.push(DepUnit {
            chunk_id,
            kind,
            depends_on,
            capabilities,
            server_module_id,
            client_calls,
            resume_entries,
        });
    }
    Some(out)
}

fn string_array(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn is_root_kind(kind: &str) -> bool {
    matches!(kind, "page" | "app")
}

/// Route / resume / rpc / action boundary entries from deployment.
pub fn plan_boundary_validators(out_dir: &Path) -> BoundaryValidatorDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return BoundaryValidatorDocument {
            schema: BOUNDARY_VALIDATOR_SCHEMA.into(),
            validators: vec![],
            status: "empty".into(),
        };
    };
    let mut validators = Vec::new();
    for u in &units {
        if u.kind == "page" {
            validators.push(BoundaryValidatorEntry {
                kind: "route".into(),
                id: u.chunk_id.clone(),
                chunk_id: u.chunk_id.clone(),
                detail: Some("page".into()),
            });
        }
        for (component, strategy) in &u.resume_entries {
            validators.push(BoundaryValidatorEntry {
                kind: "resume".into(),
                id: format!("{}:{}", u.chunk_id, component),
                chunk_id: u.chunk_id.clone(),
                detail: Some(strategy.clone()),
            });
        }
        for method in &u.client_calls {
            validators.push(BoundaryValidatorEntry {
                kind: "rpc".into(),
                id: format!("{}:{}", u.chunk_id, method),
                chunk_id: u.chunk_id.clone(),
                detail: Some(method.clone()),
            });
        }
        for cap in &u.capabilities {
            validators.push(BoundaryValidatorEntry {
                kind: "action".into(),
                id: format!("{}:{}", u.chunk_id, cap),
                chunk_id: u.chunk_id.clone(),
                detail: Some(cap.clone()),
            });
        }
    }
    validators.sort_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
    let status = if validators.is_empty() { "empty" } else { "ready" };
    BoundaryValidatorDocument {
        schema: BOUNDARY_VALIDATOR_SCHEMA.into(),
        validators,
        status: status.into(),
    }
}

/// Capabilities without `serverModuleId`; clientCalls to unknown methods.
pub fn plan_leakage(out_dir: &Path) -> LeakageDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return LeakageDocument {
            schema: LEAKAGE_SCHEMA.into(),
            findings: vec![],
            status: "empty".into(),
        };
    };

    // Resolve known capability methods across the deployment (chunk-local first, then global).
    let mut global_caps: HashSet<String> = HashSet::new();
    let mut by_chunk_caps: HashMap<String, HashSet<String>> = HashMap::new();
    for u in &units {
        let set: HashSet<String> = u.capabilities.iter().cloned().collect();
        for c in &set {
            global_caps.insert(c.clone());
        }
        by_chunk_caps.insert(u.chunk_id.clone(), set);
    }

    let mut findings = Vec::new();
    for u in &units {
        if !u.capabilities.is_empty() && u.server_module_id.is_none() {
            for cap in &u.capabilities {
                findings.push(LeakageFinding {
                    kind: "capability_without_server".into(),
                    chunk_id: u.chunk_id.clone(),
                    message: format!(
                        "capability `{cap}` on `{}` has no serverModuleId",
                        u.chunk_id
                    ),
                    capability: Some(cap.clone()),
                    method: None,
                });
            }
        }
        let local = by_chunk_caps.get(&u.chunk_id);
        for method in &u.client_calls {
            let known_local = local.map(|s| s.contains(method)).unwrap_or(false);
            let known_global = global_caps.contains(method);
            if !known_local && !known_global {
                findings.push(LeakageFinding {
                    kind: "unknown_client_call".into(),
                    chunk_id: u.chunk_id.clone(),
                    message: format!(
                        "clientCall `{method}` on `{}` does not resolve to any capability",
                        u.chunk_id
                    ),
                    capability: None,
                    method: Some(method.clone()),
                });
            }
        }
    }
    findings.sort_by(|a, b| {
        (&a.kind, &a.chunk_id, &a.message).cmp(&(&b.kind, &b.chunk_id, &b.message))
    });
    let status = if findings.is_empty() { "ready" } else { "failed" };
    LeakageDocument { schema: LEAKAGE_SCHEMA.into(), findings, status: status.into() }
}

/// Capability → target (`node` if serverModuleId else `unbound`) + conflicts.
pub fn plan_capability_targets(out_dir: &Path) -> CapabilityTargetDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return CapabilityTargetDocument {
            schema: CAPABILITY_TARGET_SCHEMA.into(),
            targets: vec![],
            conflicts: vec![],
            status: "empty".into(),
        };
    };

    let mut targets = Vec::new();
    for u in &units {
        for cap in &u.capabilities {
            let target = if u.server_module_id.is_some() { "node" } else { "unbound" };
            targets.push(CapabilityTargetEntry {
                capability: cap.clone(),
                chunk_id: u.chunk_id.clone(),
                target: target.into(),
                server_module_id: u.server_module_id.clone(),
            });
        }
    }
    targets.sort_by(|a, b| (&a.capability, &a.chunk_id).cmp(&(&b.capability, &b.chunk_id)));

    // Conflict: same capability name mapped to different targets across chunks.
    let mut by_cap: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> = BTreeMap::new();
    for t in &targets {
        by_cap
            .entry(t.capability.clone())
            .or_default()
            .entry(t.target.clone())
            .or_default()
            .insert(t.chunk_id.clone());
    }
    let mut conflicts = Vec::new();
    for (capability, target_map) in by_cap {
        if target_map.len() > 1 {
            let mut target_names: Vec<String> = target_map.keys().cloned().collect();
            target_names.sort();
            let mut chunk_ids: Vec<String> =
                target_map.values().flat_map(|s| s.iter().cloned()).collect();
            chunk_ids.sort();
            chunk_ids.dedup();
            conflicts.push(CapabilityTargetConflict {
                capability,
                targets: target_names,
                chunk_ids,
            });
        }
    }

    let status = if targets.is_empty() && conflicts.is_empty() {
        "empty"
    } else if conflicts.is_empty() {
        "ready"
    } else {
        "failed"
    };
    CapabilityTargetDocument {
        schema: CAPABILITY_TARGET_SCHEMA.into(),
        targets,
        conflicts,
        status: status.into(),
    }
}

/// BFS from page/app roots via `dependsOn`; dead chunks + unreferenced capabilities.
pub fn plan_dead_graph(out_dir: &Path) -> DeadGraphDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return DeadGraphDocument {
            schema: DEAD_GRAPH_SCHEMA.into(),
            roots: vec![],
            reachable: vec![],
            dead_chunks: vec![],
            unreferenced_capabilities: vec![],
            status: "empty".into(),
        };
    };

    let by_id: HashMap<String, &DepUnit> = units.iter().map(|u| (u.chunk_id.clone(), u)).collect();
    let mut roots: Vec<String> =
        units.iter().filter(|u| is_root_kind(&u.kind)).map(|u| u.chunk_id.clone()).collect();
    roots.sort();
    roots.dedup();

    let mut reachable: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<String> = roots.iter().cloned().collect();
    while let Some(id) = queue.pop_front() {
        if !reachable.insert(id.clone()) {
            continue;
        }
        if let Some(u) = by_id.get(&id) {
            for dep in &u.depends_on {
                if !reachable.contains(dep) {
                    queue.push_back(dep.clone());
                }
            }
        }
    }

    let mut dead_chunks: Vec<String> =
        units.iter().map(|u| u.chunk_id.clone()).filter(|id| !reachable.contains(id)).collect();
    dead_chunks.sort();

    let mut unreferenced_capabilities: Vec<String> = Vec::new();
    for u in &units {
        if dead_chunks.iter().any(|d| d == &u.chunk_id) {
            for cap in &u.capabilities {
                unreferenced_capabilities.push(format!("{}:{}", u.chunk_id, cap));
            }
        }
    }
    unreferenced_capabilities.sort();
    unreferenced_capabilities.dedup();

    let reachable_vec: Vec<String> = reachable.into_iter().collect();
    let status = if units.is_empty() { "empty" } else { "ready" };
    DeadGraphDocument {
        schema: DEAD_GRAPH_SCHEMA.into(),
        roots,
        reachable: reachable_vec,
        dead_chunks,
        unreferenced_capabilities,
        status: status.into(),
    }
}

/// Umbrella X4 check (`ready` / `failed` / `empty`).
pub fn check_dx_x4(out_dir: &Path) -> X4CheckReport {
    let boundary = plan_boundary_validators(out_dir);
    let leakage = plan_leakage(out_dir);
    let capability_targets = plan_capability_targets(out_dir);
    let dead_graph = plan_dead_graph(out_dir);

    let status = if boundary.status == "empty"
        && leakage.status == "empty"
        && capability_targets.status == "empty"
        && dead_graph.status == "empty"
    {
        "empty"
    } else if leakage.status == "failed" || capability_targets.status == "failed" {
        "failed"
    } else {
        "ready"
    };

    X4CheckReport {
        schema: X4_CHECK_SCHEMA.into(),
        boundary,
        leakage,
        capability_targets,
        dead_graph,
        status: status.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_without_deployment() {
        let dir = std::env::temp_dir().join(format!("vmz-x4-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let report = check_dx_x4(&dir);
        assert_eq!(report.status, "empty");
        assert_eq!(report.schema, X4_CHECK_SCHEMA);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dead_chunk_via_depends_on() {
        let dir = std::env::temp_dir().join(format!("vmz-x4-dead-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let json = r#"{
  "schema": "vmz.deployment.v0",
  "units": [
    {"chunkId":"pages/index","kind":"page","dependsOn":["components/Card"],"capabilities":[],"serverModuleId":null,"clientCalls":[],"resumeEntries":[]},
    {"chunkId":"components/Card","kind":"component","dependsOn":[],"capabilities":["load"],"serverModuleId":"CardServer","clientCalls":[{"method":"load","fromClientMethod":"boot"}],"resumeEntries":[]},
    {"chunkId":"components/Orphan","kind":"component","dependsOn":[],"capabilities":[],"serverModuleId":null,"clientCalls":[],"resumeEntries":[]}
  ]
}"#;
        fs::write(dir.join("vmz-deployment.json"), json).unwrap();
        let dead = plan_dead_graph(&dir);
        assert!(dead.dead_chunks.contains(&"components/Orphan".into()));
        assert!(!dead.dead_chunks.contains(&"components/Card".into()));
        let boundary = plan_boundary_validators(&dir);
        assert!(boundary.validators.iter().any(|v| v.kind == "route" && v.id == "pages/index"));
        let leak = plan_leakage(&dir);
        assert_eq!(leak.status, "ready");
        let report = check_dx_x4(&dir);
        assert_eq!(report.status, "ready");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ghost_rpc_fails_leakage() {
        let dir = std::env::temp_dir().join(format!("vmz-x4-ghost-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let json = r#"{
  "schema": "vmz.deployment.v0",
  "units": [
    {"chunkId":"pages/index","kind":"page","dependsOn":[],"capabilities":[],"serverModuleId":null,"clientCalls":[{"method":"ghostRpc","fromClientMethod":null}],"resumeEntries":[]}
  ]
}"#;
        fs::write(dir.join("vmz-deployment.json"), json).unwrap();
        let leak = plan_leakage(&dir);
        assert_eq!(leak.status, "failed");
        assert!(leak.findings.iter().any(|f| f.kind == "unknown_client_call"));
        assert_eq!(check_dx_x4(&dir).status, "failed");
        let _ = fs::remove_dir_all(&dir);
    }
}

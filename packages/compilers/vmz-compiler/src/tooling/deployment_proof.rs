//! DX: end-to-end deployment schema proofs from `vmz-deployment.json`.
//!
//! Algebraic proofs over deployment units:
//! - boundary validators (route / resume / rpc / action)
//! - client/server leakage
//! - capability to target (v0: `node` | `unbound`)
//! - dead graph (BFS from page/app roots via `dependsOn`)

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::compile::DeploymentDocument;

/// Schema id for [`BoundaryValidatorDocument`].
pub const BOUNDARY_VALIDATOR_SCHEMA: &str = "vmz.dx.boundary_validator.v0";
/// Schema id for [`LeakageDocument`].
pub const LEAKAGE_SCHEMA: &str = "vmz.dx.leakage.v0";
/// Schema id for [`CapabilityTargetDocument`].
pub const CAPABILITY_TARGET_SCHEMA: &str = "vmz.dx.capability_target.v0";
/// Schema id for [`DeadGraphDocument`].
pub const DEAD_GRAPH_SCHEMA: &str = "vmz.dx.dead_graph.v0";
/// Schema id for [`DeploymentProofCheckReport`].
pub const DEPLOYMENT_PROOF_CHECK_SCHEMA: &str = "vmz.dx.deployment_proof_check.v0";

/// Shared ready / empty / failed status for deployment proof documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProofDocStatus {
    /// Proof produced a useful result with no blocking findings.
    Ready,
    /// No deployment document (or no relevant rows) to analyze.
    Empty,
    /// Blocking findings or conflicts.
    Failed,
}

impl ProofDocStatus {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Empty => "empty",
            Self::Failed => "failed",
        }
    }
}

/// Kind of a boundary validator entry.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum BoundaryValidatorKind {
    /// Page chunk as a navigable route.
    Route,
    /// Island resume entry.
    Resume,
    /// Client-to-server RPC call.
    Rpc,
    /// Server capability / action surface.
    Action,
}

impl BoundaryValidatorKind {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Route => "route",
            Self::Resume => "resume",
            Self::Rpc => "rpc",
            Self::Action => "action",
        }
    }
}

/// One boundary validator row (route / resume / rpc / action).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryValidatorEntry {
    /// Validator kind (serde `kebab-case` enum).
    pub kind: BoundaryValidatorKind,
    /// Stable validator id within the document.
    pub id: String,
    /// Owning deployment chunk id.
    pub chunk_id: String,
    /// Optional detail (strategy, method name, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Boundary validator projection document.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct BoundaryValidatorDocument {
    /// Always [`BOUNDARY_VALIDATOR_SCHEMA`].
    pub schema: String,
    /// Validator rows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<BoundaryValidatorEntry>,
    /// Document status.
    pub status: ProofDocStatus,
}

impl BoundaryValidatorDocument {
    /// Pretty-print JSON for N-API / file emit.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Kind of a client/server leakage finding.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum LeakageFindingKind {
    /// Capability listed without a `serverModuleId`.
    CapabilityWithoutServer,
    /// `clientCall` that does not resolve to any capability.
    UnknownClientCall,
}

impl LeakageFindingKind {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CapabilityWithoutServer => "capability-without-server",
            Self::UnknownClientCall => "unknown-client-call",
        }
    }
}

/// One leakage finding.
///
/// **Tagged union** (`tag = "kind"`): capability findings carry `capability`;
/// unknown-call findings carry `method` — not a flat struct with optional both.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum LeakageFinding {
    /// Capability listed without a `serverModuleId`.
    CapabilityWithoutServer {
        /// Owning deployment chunk id.
        chunk_id: String,
        /// Human-readable message.
        message: String,
        /// Capability / method name.
        capability: String,
    },
    /// `clientCall` that does not resolve to any capability.
    UnknownClientCall {
        /// Owning deployment chunk id.
        chunk_id: String,
        /// Human-readable message.
        message: String,
        /// Client call method name.
        method: String,
    },
}

impl LeakageFinding {
    /// Closed discriminant (filter / sort helper).
    pub fn kind(&self) -> LeakageFindingKind {
        match self {
            Self::CapabilityWithoutServer { .. } => LeakageFindingKind::CapabilityWithoutServer,
            Self::UnknownClientCall { .. } => LeakageFindingKind::UnknownClientCall,
        }
    }

    /// Owning deployment chunk id.
    pub fn chunk_id(&self) -> &str {
        match self {
            Self::CapabilityWithoutServer { chunk_id, .. }
            | Self::UnknownClientCall { chunk_id, .. } => chunk_id.as_str(),
        }
    }

    /// Human-readable message.
    pub fn message(&self) -> &str {
        match self {
            Self::CapabilityWithoutServer { message, .. }
            | Self::UnknownClientCall { message, .. } => message.as_str(),
        }
    }
}

/// Client/server leakage projection document.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct LeakageDocument {
    /// Always [`LEAKAGE_SCHEMA`].
    pub schema: String,
    /// Findings (empty when clean).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub findings: Vec<LeakageFinding>,
    /// `ready` (clean) | `failed` (findings) | `empty` (no deployment).
    pub status: ProofDocStatus,
}

impl LeakageDocument {
    /// Pretty-print JSON for N-API / file emit.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Host target for a capability in v0 proofs.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityHostTarget {
    /// Capability has a `serverModuleId` (Node-side host).
    Node,
    /// Capability has no bound server module.
    Unbound,
}

impl CapabilityHostTarget {
    /// Wire / JSON label (`kebab-case`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Unbound => "unbound",
        }
    }
}

/// One capability-to-target mapping.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityTargetEntry {
    /// Capability / method name.
    pub capability: String,
    /// Owning deployment chunk id.
    pub chunk_id: String,
    /// Resolved host target.
    pub target: CapabilityHostTarget,
    /// Bound server module when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_module_id: Option<String>,
}

/// Same capability name mapped to different targets across chunks.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityTargetConflict {
    /// Capability name in conflict.
    pub capability: String,
    /// Distinct targets observed.
    pub targets: Vec<CapabilityHostTarget>,
    /// Chunk ids involved.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chunk_ids: Vec<String>,
}

/// Capability target projection document.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CapabilityTargetDocument {
    /// Always [`CAPABILITY_TARGET_SCHEMA`].
    pub schema: String,
    /// Per-chunk capability targets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<CapabilityTargetEntry>,
    /// Cross-chunk target conflicts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<CapabilityTargetConflict>,
    /// Document status.
    pub status: ProofDocStatus,
}

impl CapabilityTargetDocument {
    /// Pretty-print JSON for N-API / file emit.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Reachability / dead-chunk projection from page/app roots.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeadGraphDocument {
    /// Always [`DEAD_GRAPH_SCHEMA`].
    pub schema: String,
    /// Root chunk ids (`page` / `app`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roots: Vec<String>,
    /// Chunks reachable from roots via `dependsOn`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reachable: Vec<String>,
    /// Chunks not reachable from any root.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dead_chunks: Vec<String>,
    /// Capabilities on dead chunks (`chunkId:capability`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unreferenced_capabilities: Vec<String>,
    /// Document status.
    pub status: ProofDocStatus,
}

impl DeadGraphDocument {
    /// Pretty-print JSON for N-API / file emit.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Umbrella deployment proof check report.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentProofCheckReport {
    /// Always [`DEPLOYMENT_PROOF_CHECK_SCHEMA`].
    pub schema: String,
    /// Boundary validators sub-report.
    pub boundary: BoundaryValidatorDocument,
    /// Leakage sub-report.
    pub leakage: LeakageDocument,
    /// Capability targets sub-report.
    pub capability_targets: CapabilityTargetDocument,
    /// Dead graph sub-report.
    pub dead_graph: DeadGraphDocument,
    /// Aggregate status.
    pub status: ProofDocStatus,
}

impl DeploymentProofCheckReport {
    /// Pretty-print JSON for N-API / file emit.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone)]
struct DepUnit {
    chunk_id: String,
    kind: crate::project::VmzModuleKind,
    depends_on: Vec<String>,
    capabilities: Vec<String>,
    server_module_id: Option<String>,
    client_calls: Vec<String>,
    resume_entries: Vec<(String, String)>,
}

fn load_deployment_units(out_dir: &Path) -> Option<Vec<DepUnit>> {
    let path = out_dir.join("vmz-deployment.json");
    let text = fs::read_to_string(path).ok()?;
    let doc: DeploymentDocument = serde_json::from_str(&text).ok()?;
    let mut out = Vec::with_capacity(doc.units.len());
    for u in doc.units {
        out.push(DepUnit {
            chunk_id: u.chunk_id,
            kind: u.kind,
            depends_on: u.depends_on,
            capabilities: u.capabilities,
            server_module_id: u.server_module_id,
            client_calls: u.client_calls.into_iter().map(|c| c.method).collect(),
            resume_entries: u
                .resume_entries
                .into_iter()
                .map(|r| (r.component, r.strategy))
                .collect(),
        });
    }
    Some(out)
}

fn is_root_kind(kind: crate::project::VmzModuleKind) -> bool {
    matches!(kind, crate::project::VmzModuleKind::Page | crate::project::VmzModuleKind::Application)
}

/// Route / resume / rpc / action boundary entries from deployment.
pub fn plan_boundary_validators(out_dir: &Path) -> BoundaryValidatorDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return BoundaryValidatorDocument {
            schema: BOUNDARY_VALIDATOR_SCHEMA.into(),
            validators: vec![],
            status: ProofDocStatus::Empty,
        };
    };
    let mut validators = Vec::new();
    for u in &units {
        if u.kind == crate::project::VmzModuleKind::Page {
            validators.push(BoundaryValidatorEntry {
                kind: BoundaryValidatorKind::Route,
                id: u.chunk_id.clone(),
                chunk_id: u.chunk_id.clone(),
                detail: Some("page".into()),
            });
        }
        for (component, strategy) in &u.resume_entries {
            validators.push(BoundaryValidatorEntry {
                kind: BoundaryValidatorKind::Resume,
                id: format!("{}:{}", u.chunk_id, component),
                chunk_id: u.chunk_id.clone(),
                detail: Some(strategy.clone()),
            });
        }
        for method in &u.client_calls {
            validators.push(BoundaryValidatorEntry {
                kind: BoundaryValidatorKind::Rpc,
                id: format!("{}:{}", u.chunk_id, method),
                chunk_id: u.chunk_id.clone(),
                detail: Some(method.clone()),
            });
        }
        for cap in &u.capabilities {
            validators.push(BoundaryValidatorEntry {
                kind: BoundaryValidatorKind::Action,
                id: format!("{}:{}", u.chunk_id, cap),
                chunk_id: u.chunk_id.clone(),
                detail: Some(cap.clone()),
            });
        }
    }
    validators.sort_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
    let status = if validators.is_empty() { ProofDocStatus::Empty } else { ProofDocStatus::Ready };
    BoundaryValidatorDocument { schema: BOUNDARY_VALIDATOR_SCHEMA.into(), validators, status }
}

/// Capabilities without `serverModuleId`; clientCalls to unknown methods.
pub fn plan_leakage(out_dir: &Path) -> LeakageDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return LeakageDocument {
            schema: LEAKAGE_SCHEMA.into(),
            findings: vec![],
            status: ProofDocStatus::Empty,
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
                findings.push(LeakageFinding::CapabilityWithoutServer {
                    chunk_id: u.chunk_id.clone(),
                    message: format!(
                        "capability `{cap}` on `{}` has no serverModuleId",
                        u.chunk_id
                    ),
                    capability: cap.clone(),
                });
            }
        }
        let local = by_chunk_caps.get(&u.chunk_id);
        for method in &u.client_calls {
            let known_local = local.map(|s| s.contains(method)).unwrap_or(false);
            let known_global = global_caps.contains(method);
            if !known_local && !known_global {
                findings.push(LeakageFinding::UnknownClientCall {
                    chunk_id: u.chunk_id.clone(),
                    message: format!(
                        "clientCall `{method}` on `{}` does not resolve to any capability",
                        u.chunk_id
                    ),
                    method: method.clone(),
                });
            }
        }
    }
    findings.sort_by(|a, b| {
        (a.kind(), a.chunk_id(), a.message()).cmp(&(b.kind(), b.chunk_id(), b.message()))
    });
    let status = if findings.is_empty() { ProofDocStatus::Ready } else { ProofDocStatus::Failed };
    LeakageDocument { schema: LEAKAGE_SCHEMA.into(), findings, status }
}

/// Capability to target (`node` if serverModuleId else `unbound`) plus conflicts.
pub fn plan_capability_targets(out_dir: &Path) -> CapabilityTargetDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return CapabilityTargetDocument {
            schema: CAPABILITY_TARGET_SCHEMA.into(),
            targets: vec![],
            conflicts: vec![],
            status: ProofDocStatus::Empty,
        };
    };

    let mut targets = Vec::new();
    for u in &units {
        for cap in &u.capabilities {
            let target = if u.server_module_id.is_some() {
                CapabilityHostTarget::Node
            } else {
                CapabilityHostTarget::Unbound
            };
            targets.push(CapabilityTargetEntry {
                capability: cap.clone(),
                chunk_id: u.chunk_id.clone(),
                target,
                server_module_id: u.server_module_id.clone(),
            });
        }
    }
    targets.sort_by(|a, b| (&a.capability, &a.chunk_id).cmp(&(&b.capability, &b.chunk_id)));

    // Conflict: same capability name mapped to different targets across chunks.
    let mut by_cap: BTreeMap<String, BTreeMap<CapabilityHostTarget, BTreeSet<String>>> =
        BTreeMap::new();
    for t in &targets {
        by_cap
            .entry(t.capability.clone())
            .or_default()
            .entry(t.target)
            .or_default()
            .insert(t.chunk_id.clone());
    }
    let mut conflicts = Vec::new();
    for (capability, target_map) in by_cap {
        if target_map.len() > 1 {
            let mut target_names: Vec<CapabilityHostTarget> = target_map.keys().copied().collect();
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
        ProofDocStatus::Empty
    } else if conflicts.is_empty() {
        ProofDocStatus::Ready
    } else {
        ProofDocStatus::Failed
    };
    CapabilityTargetDocument { schema: CAPABILITY_TARGET_SCHEMA.into(), targets, conflicts, status }
}

/// BFS from page/app roots via `dependsOn`; dead chunks plus unreferenced capabilities.
pub fn plan_dead_graph(out_dir: &Path) -> DeadGraphDocument {
    let Some(units) = load_deployment_units(out_dir) else {
        return DeadGraphDocument {
            schema: DEAD_GRAPH_SCHEMA.into(),
            roots: vec![],
            reachable: vec![],
            dead_chunks: vec![],
            unreferenced_capabilities: vec![],
            status: ProofDocStatus::Empty,
        };
    };

    let by_id: HashMap<String, &DepUnit> = units.iter().map(|u| (u.chunk_id.clone(), u)).collect();
    let mut roots: Vec<String> =
        units.iter().filter(|u| is_root_kind(u.kind)).map(|u| u.chunk_id.clone()).collect();
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
    let status = if units.is_empty() { ProofDocStatus::Empty } else { ProofDocStatus::Ready };
    DeadGraphDocument {
        schema: DEAD_GRAPH_SCHEMA.into(),
        roots,
        reachable: reachable_vec,
        dead_chunks,
        unreferenced_capabilities,
        status,
    }
}

/// Umbrella check (`ready` / `failed` / `empty`).
pub fn check_deployment_proof(out_dir: &Path) -> DeploymentProofCheckReport {
    let boundary = plan_boundary_validators(out_dir);
    let leakage = plan_leakage(out_dir);
    let capability_targets = plan_capability_targets(out_dir);
    let dead_graph = plan_dead_graph(out_dir);

    let status = if boundary.status == ProofDocStatus::Empty
        && leakage.status == ProofDocStatus::Empty
        && capability_targets.status == ProofDocStatus::Empty
        && dead_graph.status == ProofDocStatus::Empty
    {
        ProofDocStatus::Empty
    } else if leakage.status == ProofDocStatus::Failed
        || capability_targets.status == ProofDocStatus::Failed
    {
        ProofDocStatus::Failed
    } else {
        ProofDocStatus::Ready
    };

    DeploymentProofCheckReport {
        schema: DEPLOYMENT_PROOF_CHECK_SCHEMA.into(),
        boundary,
        leakage,
        capability_targets,
        dead_graph,
        status,
    }
}

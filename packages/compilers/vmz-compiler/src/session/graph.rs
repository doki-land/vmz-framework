//! In-memory session graph index.
//!
//! Long-lived Workspace keeps a coarse VPG/Deployment index across rebuilds.
//! Full incremental semantic VPG remains later; this closes the
//! N-API "session owns the graph" requirement for HMR / explain / query.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Schema id for [`SessionGraphDocument`].
pub const SESSION_GRAPH_SCHEMA: &str = "vmz.session.v0";

/// One client->server call edge on a session unit.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionClientCall {
    /// Server method name.
    pub method: String,
    /// Optional client method that issued the call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_client_method: Option<String>,
}

/// One unit row in the session graph index / wire document.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUnit {
    /// Chunk id (also the HashMap key in [`SessionGraph::units`]).
    pub chunk_id: String,
    /// Unit kind (closed unit enum).
    pub kind: crate::project::VmzModuleKind,
    /// Workspace-relative source path.
    pub source: String,
    /// Outbound chunk dependencies.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Inbound reverse dependents.
    #[serde(default)]
    pub depended_by: Vec<String>,
    /// Server capability method names.
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// Lifetime / control region ids.
    #[serde(default)]
    pub region_ids: Vec<u32>,
    /// Co-located server module id when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_module_id: Option<String>,
    /// Proven client->server calls.
    #[serde(default)]
    pub client_calls: Vec<SessionClientCall>,
    /// Relative path of the unit's `*.program.json`.
    #[serde(default)]
    pub program_ir: String,
}

/// Wire document for [`SessionGraph::to_json`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphDocument {
    /// Always [`SESSION_GRAPH_SCHEMA`].
    pub schema: String,
    /// Session generation counter.
    pub generation: u64,
    /// Whether the last rebuild was full-program.
    pub full: bool,
    /// Whether only island regions need HMR refresh.
    pub island_hmr: bool,
    /// Chunk ids in the current affected set.
    #[serde(default)]
    pub affected_chunks: Vec<String>,
    /// All indexed units (sorted by chunk id on emit).
    #[serde(default)]
    pub units: Vec<SessionUnit>,
}

/// In-memory session graph keyed by chunk id.
#[derive(Debug, Clone, Default)]
pub struct SessionGraph {
    /// Monotonic generation bumped on refresh.
    pub generation: u64,
    /// Last rebuild was full-program.
    pub full: bool,
    /// Island-only HMR flag from deployment.
    pub island_hmr: bool,
    /// Affected chunk ids from the last build.
    pub affected_chunks: Vec<String>,
    /// Units keyed by chunk id.
    pub units: HashMap<String, SessionUnit>,
}

impl SessionGraph {
    /// Clear units and affected set (generation unchanged).
    pub fn clear(&mut self) {
        self.units.clear();
        self.affected_chunks.clear();
        self.full = false;
        self.island_hmr = false;
    }

    /// Rebuild index from emitted `vmz-deployment.json` (authoritative after build).
    pub fn refresh_from_deployment(&mut self, out_dir: &Path) -> bool {
        let path = out_dir.join("vmz-deployment.json");
        let Ok(text) = fs::read_to_string(&path) else {
            return false;
        };
        let Ok(doc) = serde_json::from_str::<DeploymentIndexDocument>(&text) else {
            return false;
        };
        self.generation = self.generation.saturating_add(1);
        self.units.clear();
        self.full = doc.full;
        self.island_hmr = doc.island_hmr;
        self.affected_chunks = doc.affected_chunks;
        for u in doc.units {
            let unit = SessionUnit {
                chunk_id: u.chunk_id.clone(),
                kind: u.kind,
                source: u.source,
                depends_on: u.depends_on,
                depended_by: u.depended_by,
                capabilities: u.capabilities,
                region_ids: u.region_ids,
                server_module_id: u.server_module_id,
                client_calls: u.client_calls,
                program_ir: u.program_ir,
            };
            self.units.insert(unit.chunk_id.clone(), unit);
        }
        true
    }

    /// Pretty JSON document for explain / verify.
    pub fn to_json(&self) -> String {
        let mut units: Vec<SessionUnit> = self.units.values().cloned().collect();
        units.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));
        let doc = SessionGraphDocument {
            schema: SESSION_GRAPH_SCHEMA.into(),
            generation: self.generation,
            full: self.full,
            island_hmr: self.island_hmr,
            affected_chunks: self.affected_chunks.clone(),
            units,
        };
        format!("{}\n", vmz_generator::to_pretty_json(&doc).unwrap_or_else(|_| "{}".into()))
    }
}

/// Subset of `vmz-deployment.json` needed to refresh the session index.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentIndexDocument {
    #[serde(default)]
    full: bool,
    #[serde(default)]
    island_hmr: bool,
    #[serde(default)]
    affected_chunks: Vec<String>,
    #[serde(default)]
    units: Vec<SessionUnit>,
}

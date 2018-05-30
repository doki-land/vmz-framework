//! In-memory session graph index (session).
//!
//! Long-lived Workspace keeps a coarse VPG/Deployment index across rebuilds.
//! Full incremental semantic VPG remains later — this closes the
//! N-API “session owns the graph” requirement for HMR / explain / query.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct SessionUnit {
    pub chunk_id: String,
    pub kind: String,
    pub source: String,
    pub depends_on: Vec<String>,
    pub depended_by: Vec<String>,
    pub capabilities: Vec<String>,
    pub region_ids: Vec<u32>,
    pub server_module_id: Option<String>,
    pub client_calls: Vec<(String, Option<String>)>,
    pub program_ir: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionGraph {
    pub generation: u64,
    pub full: bool,
    pub island_hmr: bool,
    pub affected_chunks: Vec<String>,
    pub units: HashMap<String, SessionUnit>,
}

impl SessionGraph {
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
        let Ok(root) = serde_json::from_str::<Value>(&text) else {
            return false;
        };
        self.generation = self.generation.saturating_add(1);
        self.units.clear();
        self.full = root.get("full").and_then(|v| v.as_bool()).unwrap_or(false);
        self.island_hmr = root.get("islandHmr").and_then(|v| v.as_bool()).unwrap_or(false);
        self.affected_chunks = string_array(root.get("affectedChunks"));

        let Some(units) = root.get("units").and_then(|v| v.as_array()) else {
            return true;
        };
        for item in units {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let Some(chunk_id) = obj.get("chunkId").and_then(|v| v.as_str()).map(str::to_string)
            else {
                continue;
            };
            let unit = SessionUnit {
                chunk_id: chunk_id.clone(),
                kind: obj.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                source: obj.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                depends_on: string_array(obj.get("dependsOn")),
                depended_by: string_array(obj.get("dependedBy")),
                capabilities: string_array(obj.get("capabilities")),
                region_ids: number_array(obj.get("regionIds")),
                server_module_id: obj
                    .get("serverModuleId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                client_calls: client_calls(obj.get("clientCalls")),
                program_ir: obj
                    .get("programIr")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{chunk_id}.program.json")),
            };
            self.units.insert(chunk_id, unit);
        }
        true
    }

    pub fn invalidate_chunks(&mut self, chunks: impl IntoIterator<Item = String>) {
        for c in chunks {
            self.units.remove(&c);
        }
        self.generation = self.generation.saturating_add(1);
    }

    pub fn to_json(&self) -> String {
        let mut units: Vec<&SessionUnit> = self.units.values().collect();
        units.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));
        let units_json: Vec<Value> = units
            .iter()
            .map(|u| {
                let calls: Vec<Value> = u
                    .client_calls
                    .iter()
                    .map(|(m, from)| {
                        serde_json::json!({
                            "method": m,
                            "fromClientMethod": from,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "chunkId": u.chunk_id,
                    "kind": u.kind,
                    "source": u.source,
                    "dependsOn": u.depends_on,
                    "dependedBy": u.depended_by,
                    "capabilities": u.capabilities,
                    "regionIds": u.region_ids,
                    "serverModuleId": u.server_module_id,
                    "clientCalls": calls,
                    "programIr": u.program_ir,
                })
            })
            .collect();
        let root = serde_json::json!({
            "schema": "vmz.session.v0",
            "generation": self.generation,
            "full": self.full,
            "islandHmr": self.island_hmr,
            "affectedChunks": self.affected_chunks,
            "units": units_json,
        });
        // Pretty enough for verify that substring-match; keep stable key order via json! macro.
        format!("{}\n", serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{}".into()))
    }
}

fn string_array(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn number_array(v: Option<&Value>) -> Vec<u32> {
    v.and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.as_u64().map(|n| n as u32)).collect())
        .unwrap_or_default()
}

fn client_calls(v: Option<&Value>) -> Vec<(String, Option<String>)> {
    v.and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let method = item.get("method")?.as_str()?.to_string();
                    let from = item.get("fromClientMethod").and_then(|f| {
                        if f.is_null() { None } else { f.as_str().map(str::to_string) }
                    });
                    Some((method, from))
                })
                .collect()
        })
        .unwrap_or_default()
}

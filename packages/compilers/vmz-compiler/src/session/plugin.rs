//! Plugin contribution protocol v1 .
//!
//! Plugins submit **versioned batches**; Rust validates and merges. No JS AST
//! callbacks and no direct VPG mutation handles.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use crate::diagnostic::ReportedDiagnostic;

/// Locked plugin protocol id (must match Node `PLUGIN_PROTOCOL`).
pub const PLUGIN_PROTOCOL_V1: &str = vmz_protocol::PLUGIN_PROTOCOL;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PluginStage {
    /// Virtual files / resolve maps → [`ContributionKind::Source`].
    WorkspaceResolve,
    /// External format → VMZ source (still a source contribution).
    SourceAdapter,
    /// Read-only diagnostics / advice.
    Analyzer,
    /// Deployment target manifests (how to deploy, not what the program means).
    Target,
}

impl PluginStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceResolve => "workspace_resolve",
            Self::SourceAdapter => "source_adapter",
            Self::Analyzer => "analyzer",
            Self::Target => "target",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "workspace_resolve" | "WorkspaceResolve" => Some(Self::WorkspaceResolve),
            "source_adapter" | "SourceAdapter" => Some(Self::SourceAdapter),
            "analyzer" | "Analyzer" => Some(Self::Analyzer),
            "target" | "Target" => Some(Self::Target),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provenance {
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContributionKind {
    Source {
        /// Path relative to workspace root (must stay inside root).
        path: PathBuf,
        content: String,
        /// Hex sha256 of UTF-8 content (lowercase).
        content_hash: String,
        /// When true, materialize onto disk under the workspace root before build/check.
        materialize: bool,
    },
    Analyzer {
        path: PathBuf,
        severity: String,
        message: String,
        code: Option<String>,
    },
    Target {
        target_id: String,
        kind: String,
        /// Opaque JSON object text (validated as object-ish: starts with `{`).
        manifest_json: String,
    },
    /// Explicitly rejected — plugins must not send VPG mutation.
    GraphMutation {
        detail: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContributionItem {
    /// Stable id within the plugin (used for diff / cache).
    pub id: String,
    pub kind: ContributionKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContributionBatch {
    pub plugin: PluginIdentity,
    pub protocol: String,
    pub stage: PluginStage,
    /// Host-declared cache key (deterministic plugins should hash inputs).
    pub cache_key: String,
    pub deterministic: bool,
    pub items: Vec<ContributionItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub plugin: String,
    pub item_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContributionDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ApplyContributionsReport {
    pub accepted: usize,
    pub rejected: Vec<Rejection>,
    pub diff: ContributionDiff,
}

/// Accepted contribution store owned by [`crate::workspace::Workspace`].
#[derive(Debug, Default, Clone)]
pub struct ContributionStore {
    /// key = `plugin@version::item_id`
    items: HashMap<String, StoredContribution>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct StoredContribution {
    plugin: PluginIdentity,
    stage: PluginStage,
    cache_key: String,
    item: ContributionItem,
}

impl ContributionStore {
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.items.keys()
    }

    /// Coarse provenance rows for `Workspace::explain` (plugin contributions).
    pub fn explain_rows(&self) -> Vec<ExplainContribution> {
        let mut rows: Vec<_> = self
            .items
            .iter()
            .map(|(key, stored)| {
                let (kind, path) = match &stored.item.kind {
                    ContributionKind::Source { path, .. } => {
                        ("source", Some(path.display().to_string()))
                    }
                    ContributionKind::Analyzer { path, .. } => {
                        ("analyzer", Some(path.display().to_string()))
                    }
                    ContributionKind::Target { .. } => ("target", None),
                    ContributionKind::GraphMutation { .. } => ("graph_mutation", None),
                };
                ExplainContribution {
                    id: key.clone(),
                    plugin: stored.plugin.name.clone(),
                    version: stored.plugin.version.clone(),
                    stage: stored.stage.as_str().to_string(),
                    kind: kind.into(),
                    item_id: stored.item.id.clone(),
                    path,
                    cache_key: stored.cache_key.clone(),
                }
            })
            .collect();
        rows.sort_by(|a, b| a.id.cmp(&b.id));
        rows
    }

    fn full_id(plugin: &PluginIdentity, item_id: &str) -> String {
        format!("{}@{}::{item_id}", plugin.name, plugin.version)
    }

    /// Validate and merge a batch. Invalid items are rejected; previous successful
    /// store is kept for rejected items (failed contributions do not wipe the graph).
    pub fn apply_batch(
        &mut self,
        batch: &ContributionBatch,
        root: &Path,
    ) -> ApplyContributionsReport {
        let mut report = ApplyContributionsReport::default();
        if batch.protocol != PLUGIN_PROTOCOL_V1 {
            report.rejected.push(Rejection {
                plugin: batch.plugin.name.clone(),
                item_id: "*".into(),
                reason: format!(
                    "plugin protocol `{}` != native `{PLUGIN_PROTOCOL_V1}`",
                    batch.protocol
                ),
            });
            return report;
        }

        let mut batch_keys = HashSet::new();
        for item in &batch.items {
            let key = Self::full_id(&batch.plugin, &item.id);
            batch_keys.insert(key.clone());
            match validate_item(batch, item, root) {
                Ok(()) => {
                    let prev = self.items.insert(
                        key.clone(),
                        StoredContribution {
                            plugin: batch.plugin.clone(),
                            stage: batch.stage,
                            cache_key: batch.cache_key.clone(),
                            item: item.clone(),
                        },
                    );
                    report.accepted += 1;
                    if prev.is_some() {
                        report.diff.unchanged.push(key);
                    } else {
                        report.diff.added.push(key);
                    }
                }
                Err(reason) => {
                    report.rejected.push(Rejection {
                        plugin: batch.plugin.name.clone(),
                        item_id: item.id.clone(),
                        reason,
                    });
                }
            }
        }

        // Diff removals: prior keys from this plugin **and stage** not in the new batch.
        // Other stages from the same plugin must remain ( multi-stage apply).
        let plugin_prefix = format!("{}@{}::", batch.plugin.name, batch.plugin.version);
        let stale: Vec<String> = self
            .items
            .iter()
            .filter(|(k, v)| {
                k.starts_with(&plugin_prefix) && v.stage == batch.stage && !batch_keys.contains(*k)
            })
            .map(|(k, _)| k.clone())
            .collect();
        for k in stale {
            self.items.remove(&k);
            report.diff.removed.push(k);
        }

        report
    }

    /// Write materializable sources under `root` (sandbox). Returns written paths.
    pub fn materialize_sources(&self, root: &Path) -> crate::Result<Vec<PathBuf>> {
        let mut written = Vec::new();
        for stored in self.items.values() {
            if let ContributionKind::Source { path, content, materialize, .. } = &stored.item.kind {
                if !*materialize {
                    continue;
                }
                let abs = sandbox_join(root, path)?;
                if let Some(parent) = abs.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&abs, content)?;
                written.push(abs);
            }
        }
        Ok(written)
    }

    pub fn analyzer_diagnostics(&self) -> Vec<ReportedDiagnostic> {
        let mut out = Vec::new();
        for stored in self.items.values() {
            if let ContributionKind::Analyzer { path, severity, message, .. } = &stored.item.kind {
                let msg = format!("[plugin {}:{}] {message}", stored.plugin.name, stored.item.id);
                out.push(match severity.as_str() {
                    "warning" | "warn" => ReportedDiagnostic::warning(path, msg),
                    "advice" | "info" => ReportedDiagnostic::warning(path, msg),
                    _ => ReportedDiagnostic::error(path, msg),
                });
            }
        }
        out
    }

    /// Emit target manifests into `out_dir/vmz-targets/` and a summary JSON.
    pub fn emit_targets(&self, out_dir: &Path) -> crate::Result<Vec<PathBuf>> {
        let mut emitted = Vec::new();
        let targets_dir = out_dir.join("vmz-targets");
        std::fs::create_dir_all(&targets_dir)?;
        let mut summary =
            String::from("{\n  \"schema\": \"vmz.plugin.targets.v1\",\n  \"targets\": [\n");
        let mut first = true;
        for stored in self.items.values() {
            if let ContributionKind::Target { target_id, kind, manifest_json } = &stored.item.kind {
                let file = targets_dir.join(format!("{target_id}.json"));
                let body = format!(
                    "{{\n  \"schema\": \"vmz.plugin.target.v1\",\n  \"targetId\": {:?},\n  \"kind\": {:?},\n  \"plugin\": {:?},\n  \"pluginVersion\": {:?},\n  \"contributionId\": {:?},\n  \"manifest\": {manifest_json}\n}}\n",
                    target_id, kind, stored.plugin.name, stored.plugin.version, stored.item.id,
                );
                std::fs::write(&file, body)?;
                emitted.push(file);
                if !first {
                    summary.push_str(",\n");
                }
                first = false;
                summary.push_str(&format!(
                    "    {{ \"id\": {:?}, \"kind\": {:?}, \"plugin\": {:?}, \"file\": {:?} }}",
                    target_id,
                    kind,
                    stored.plugin.name,
                    format!("vmz-targets/{target_id}.json"),
                ));
            }
        }
        summary.push_str("\n  ]\n}\n");
        let summary_path = out_dir.join("vmz-plugin-targets.json");
        std::fs::write(&summary_path, summary)?;
        emitted.push(summary_path);
        Ok(emitted)
    }
}

#[derive(Debug, Clone)]
pub struct ExplainContribution {
    pub id: String,
    pub plugin: String,
    pub version: String,
    pub stage: String,
    pub kind: String,
    pub item_id: String,
    pub path: Option<String>,
    pub cache_key: String,
}

fn validate_item(
    batch: &ContributionBatch,
    item: &ContributionItem,
    root: &Path,
) -> Result<(), String> {
    if item.id.is_empty() || item.id.contains("::") {
        return Err("contribution id must be non-empty and must not contain `::`".into());
    }
    match &item.kind {
        ContributionKind::GraphMutation { detail } => {
            Err(format!("graph mutation contributions are forbidden (N3): {detail}"))
        }
        ContributionKind::Source { path, content, content_hash, .. } => {
            if !matches!(batch.stage, PluginStage::WorkspaceResolve | PluginStage::SourceAdapter) {
                return Err(format!(
                    "source contribution not allowed in stage `{}`",
                    batch.stage.as_str()
                ));
            }
            sandbox_join(root, path).map_err(|e| e.to_string())?;
            let actual = sha256_hex(content.as_bytes());
            if !actual.eq_ignore_ascii_case(content_hash) {
                return Err(format!(
                    "content_hash mismatch for `{}`: claimed `{content_hash}` actual `{actual}`",
                    path.display()
                ));
            }
            Ok(())
        }
        ContributionKind::Analyzer { severity, message, .. } => {
            if batch.stage != PluginStage::Analyzer {
                return Err(format!(
                    "analyzer contribution not allowed in stage `{}`",
                    batch.stage.as_str()
                ));
            }
            if message.is_empty() {
                return Err("analyzer message must be non-empty".into());
            }
            match severity.as_str() {
                "error" | "warning" | "warn" | "advice" | "info" => Ok(()),
                other => Err(format!("unknown analyzer severity `{other}`")),
            }
        }
        ContributionKind::Target { target_id, kind, manifest_json } => {
            if batch.stage != PluginStage::Target {
                return Err(format!(
                    "target contribution not allowed in stage `{}`",
                    batch.stage.as_str()
                ));
            }
            if target_id.is_empty() || kind.is_empty() {
                return Err("target_id and kind must be non-empty".into());
            }
            let trimmed = manifest_json.trim();
            if !(trimmed.starts_with('{') && trimmed.ends_with('}')) {
                return Err("target manifest_json must be a JSON object".into());
            }
            Ok(())
        }
    }
}

fn sandbox_join(root: &Path, rel: &Path) -> crate::Result<PathBuf> {
    if rel.is_absolute() {
        crate::bail!("contribution path must be relative: {}", rel.display());
    }
    for c in rel.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                crate::bail!("contribution path escapes sandbox: {}", rel.display());
            }
            _ => {}
        }
    }
    Ok(root.join(rel))
}

/// Lowercase hex SHA-256 (`sha2`).
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Alias kept for existing call sites / public API.
pub fn sha256_hex_bytes(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

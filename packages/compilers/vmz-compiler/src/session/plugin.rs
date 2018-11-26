//! Plugin contribution protocol v1.
//!
//! Plugins submit versioned batches; Rust validates and merges. No JS AST
//! callbacks and no direct VPG mutation handles.
//!
//! Wire shape rules match `vmz-types`: closed payloads are tagged unions or
//! unit enums; intentionally open host labels stay `String` and are documented.
//! Emit paths use typed `Serialize` — never hand-built JSON strings.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::diagnostic::{ReportedDiagnostic, Severity, severity_wire};

/// Locked plugin protocol id (must match Node `PLUGIN_PROTOCOL`).
pub const PLUGIN_PROTOCOL_V1: &str = vmz_protocol::PLUGIN_PROTOCOL;

/// Schema id for [`PluginTargetsSummary`].
pub const PLUGIN_TARGETS_SUMMARY_SCHEMA: &str = "vmz.plugin.targets.v1";
/// Schema id for [`PluginTargetDocument`].
pub const PLUGIN_TARGET_SCHEMA: &str = "vmz.plugin.target.v1";

pub use vmz_protocol::{ExplainContributionSurface, PluginStage};

/// Plugin name + semver-ish version string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PluginIdentity {
    /// Plugin package / id.
    pub name: String,
    /// Plugin version string.
    pub version: String,
}

/// Free-form provenance note attached by hosts (optional tooling).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Provenance {
    /// Human-readable note.
    pub note: String,
}

/// One contribution payload inside a batch.
///
/// **Tagged union** (`tag = "kind"`). Call sites should `match` the variant,
/// not compare a parallel `kind` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ContributionKind {
    /// Virtual or adapted source file.
    Source {
        /// Path relative to workspace root (must stay inside root).
        path: PathBuf,
        /// Full UTF-8 file contents.
        content: String,
        /// Hex sha256 of UTF-8 content (lowercase).
        content_hash: String,
        /// When true, materialize onto disk under the workspace root before build/check.
        #[serde(default)]
        materialize: bool,
    },
    /// Analyzer diagnostic contribution.
    Analyzer {
        /// Workspace-relative path the diagnostic applies to.
        path: PathBuf,
        /// oxc [`Severity`] on the wire as kebab-case (`error` | `warning` | `advice`).
        #[serde(with = "severity_wire")]
        #[schemars(with = "String")]
        severity: Severity,
        /// Diagnostic message body.
        message: String,
        /// Optional machine-readable code.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// Deployment target manifest contribution.
    Target {
        /// Stable target id (file stem under `vmz-targets/`).
        target_id: String,
        /// **Open** host-defined target kind label (plugins invent deploy flavors).
        ///
        /// Named `target_kind` so it does not collide with the serde `tag = "kind"`.
        target_kind: String,
        /// Opaque JSON **object** (validated as `JsonValue::Object` on apply).
        ///
        /// Prefer this over a pre-serialized `manifestJson` string.
        manifest: JsonValue,
    },
    /// Explicitly rejected: plugins must not send VPG mutation.
    GraphMutation {
        /// Why the mutation was attempted / rejected.
        detail: String,
    },
}

/// One item inside a [`ContributionBatch`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ContributionItem {
    /// Stable id within the plugin (used for diff / cache).
    pub id: String,
    /// Contribution payload.
    #[serde(flatten)]
    pub kind: ContributionKind,
}

/// Versioned batch submitted by a plugin host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContributionBatch {
    /// Submitting plugin identity.
    pub plugin: PluginIdentity,
    /// Must equal [`PLUGIN_PROTOCOL_V1`].
    pub protocol: String,
    /// Stage that owns this batch.
    pub stage: PluginStage,
    /// Host-declared cache key (deterministic plugins should hash inputs).
    pub cache_key: String,
    /// Whether the host claims deterministic output for this cache key.
    pub deterministic: bool,
    /// Contribution items.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<ContributionItem>,
}

/// One rejected contribution item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Rejection {
    /// Plugin name that submitted the item.
    pub plugin: String,
    /// Item id (or `*` for batch-level rejection).
    pub item_id: String,
    /// Human-readable rejection reason.
    pub reason: String,
}

/// Diff of store keys after applying a batch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ContributionDiff {
    /// Newly accepted keys.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub added: Vec<String>,
    /// Keys removed because they were absent from the new batch (same stage).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed: Vec<String>,
    /// Keys that already existed and were replaced in place.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unchanged: Vec<String>,
}

/// Result of [`ContributionStore::apply_batch`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct ApplyContributionsReport {
    /// Number of items accepted into the store.
    pub accepted: usize,
    /// Rejected items (store kept prior successful entries).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rejected: Vec<Rejection>,
    /// Key-level diff for this apply.
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
    /// Number of accepted contribution keys currently stored.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// True when no contributions are stored.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Iterate stored keys (`plugin@version::item_id`).
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.items.keys()
    }

    /// Coarse provenance rows for `Workspace::explain` (plugin contributions).
    pub fn explain_rows(&self) -> Vec<ExplainContributionRow> {
        let mut rows: Vec<_> = self
            .items
            .iter()
            .map(|(key, stored)| {
                let (kind, path) = match &stored.item.kind {
                    ContributionKind::Source { path, .. } => {
                        (ExplainContributionSurface::Source, Some(path.display().to_string()))
                    }
                    ContributionKind::Analyzer { path, .. } => {
                        (ExplainContributionSurface::Analyzer, Some(path.display().to_string()))
                    }
                    ContributionKind::Target { .. } => (ExplainContributionSurface::Target, None),
                    ContributionKind::GraphMutation { .. } => {
                        (ExplainContributionSurface::GraphMutation, None)
                    }
                };
                ExplainContributionRow {
                    id: key.clone(),
                    plugin: stored.plugin.name.clone(),
                    version: stored.plugin.version.clone(),
                    stage: stored.stage,
                    kind,
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

    /// Collect analyzer diagnostics from accepted contributions.
    pub fn analyzer_diagnostics(&self) -> Vec<ReportedDiagnostic> {
        let mut out = Vec::new();
        for stored in self.items.values() {
            if let ContributionKind::Analyzer { path, severity, message, .. } = &stored.item.kind {
                out.push(
                    ReportedDiagnostic::with_severity(path, *severity, "vmz::plugin::analyzer")
                        .with_arg("plugin", stored.plugin.name.clone())
                        .with_arg("id", stored.item.id.clone())
                        .with_arg("detail", message.clone()),
                );
            }
        }
        out
    }

    /// Emit target manifests into `out_dir/vmz-targets/` and a summary JSON.
    ///
    /// Bodies are typed [`PluginTargetDocument`] / [`PluginTargetsSummary`] —
    /// never hand-built JSON strings.
    pub fn emit_targets(&self, out_dir: &Path) -> crate::Result<Vec<PathBuf>> {
        let mut emitted = Vec::new();
        let targets_dir = out_dir.join("vmz-targets");
        std::fs::create_dir_all(&targets_dir)?;

        let mut summary = PluginTargetsSummary {
            schema: PLUGIN_TARGETS_SUMMARY_SCHEMA.into(),
            targets: Vec::new(),
        };

        for stored in self.items.values() {
            if let ContributionKind::Target { target_id, target_kind, manifest } = &stored.item.kind
            {
                let rel_file = format!("vmz-targets/{target_id}.json");
                let file = targets_dir.join(format!("{target_id}.json"));
                let doc = PluginTargetDocument {
                    schema: PLUGIN_TARGET_SCHEMA.into(),
                    target_id: target_id.clone(),
                    kind: target_kind.clone(),
                    plugin: stored.plugin.name.clone(),
                    plugin_version: stored.plugin.version.clone(),
                    contribution_id: stored.item.id.clone(),
                    manifest: manifest.clone(),
                };
                let body = vmz_generator::to_pretty_json(&doc)
                    .map_err(|e| format!("serialize plugin target `{target_id}`: {e}"))?;
                std::fs::write(&file, format!("{body}\n"))?;
                emitted.push(file);
                summary.targets.push(PluginTargetSummaryEntry {
                    id: target_id.clone(),
                    kind: target_kind.clone(),
                    plugin: stored.plugin.name.clone(),
                    file: rel_file,
                });
            }
        }

        summary.targets.sort_by(|a, b| a.id.cmp(&b.id));
        let summary_path = out_dir.join("vmz-plugin-targets.json");
        let summary_body = vmz_generator::to_pretty_json(&summary)
            .map_err(|e| format!("serialize plugin targets summary: {e}"))?;
        std::fs::write(&summary_path, format!("{summary_body}\n"))?;
        emitted.push(summary_path);
        Ok(emitted)
    }
}

/// One accepted target document written under `vmz-targets/`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginTargetDocument {
    /// Always [`PLUGIN_TARGET_SCHEMA`].
    pub schema: String,
    /// Stable target id (file stem).
    pub target_id: String,
    /// **Open** host-defined kind label (same as contribution `targetKind`).
    pub kind: String,
    /// Plugin package / id.
    pub plugin: String,
    /// Plugin version string.
    pub plugin_version: String,
    /// Contribution item id within the plugin.
    pub contribution_id: String,
    /// Opaque JSON object from the contribution.
    pub manifest: JsonValue,
}

/// One row in [`PluginTargetsSummary`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PluginTargetSummaryEntry {
    /// Target id.
    pub id: String,
    /// **Open** host-defined kind label.
    pub kind: String,
    /// Plugin package / id.
    pub plugin: String,
    /// Workspace-relative path (`vmz-targets/{id}.json`).
    pub file: String,
}

/// Summary index of all emitted plugin targets for a build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PluginTargetsSummary {
    /// Always [`PLUGIN_TARGETS_SUMMARY_SCHEMA`].
    pub schema: String,
    /// Target rows (sorted by id on emit).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<PluginTargetSummaryEntry>,
}

/// Session-side explain row before mapping into `vmz_protocol::ExplainContribution`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExplainContributionRow {
    /// Store key (`plugin@version::item_id`).
    pub id: String,
    /// Plugin package / id.
    pub plugin: String,
    /// Plugin version string.
    pub version: String,
    /// Closed stage that accepted the item.
    pub stage: PluginStage,
    /// Closed contribution surface.
    pub kind: ExplainContributionSurface,
    /// Item id within the plugin.
    pub item_id: String,
    /// Optional workspace-relative path (source / analyzer).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Host-declared cache key for the batch.
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
        ContributionKind::Analyzer { message, .. } => {
            if batch.stage != PluginStage::Analyzer {
                return Err(format!(
                    "analyzer contribution not allowed in stage `{}`",
                    batch.stage.as_str()
                ));
            }
            if message.is_empty() {
                return Err("analyzer message must be non-empty".into());
            }
            Ok(())
        }
        ContributionKind::Target { target_id, target_kind, manifest } => {
            if batch.stage != PluginStage::Target {
                return Err(format!(
                    "target contribution not allowed in stage `{}`",
                    batch.stage.as_str()
                ));
            }
            if target_id.is_empty() || target_kind.is_empty() {
                return Err("target_id and target_kind must be non-empty".into());
            }
            if !manifest.is_object() {
                return Err("target manifest must be a JSON object".into());
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

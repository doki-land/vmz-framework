//! Plugin contribution protocol v1 (N3).
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
        // Other stages from the same plugin must remain (N3 multi-stage apply).
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
    pub fn materialize_sources(&self, root: &Path) -> anyhow::Result<Vec<PathBuf>> {
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
    pub fn emit_targets(&self, out_dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
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

fn sandbox_join(root: &Path, rel: &Path) -> anyhow::Result<PathBuf> {
    if rel.is_absolute() {
        anyhow::bail!("contribution path must be relative: {}", rel.display());
    }
    for c in rel.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                anyhow::bail!("contribution path escapes sandbox: {}", rel.display());
            }
            _ => {}
        }
    }
    Ok(root.join(rel))
}

fn sha256_hex(bytes: &[u8]) -> String {
    // Minimal SHA-256 (no extra crate): use a compact public-domain style impl.
    // Prefer std-only to avoid new deps — use `sha2` if already present; else hand-roll via
    // a tiny dependency-free implementation.
    sha256::digest(bytes)
}

/// Tiny SHA-256 helper without pulling openssl. Uses the `sha2`-compatible pure Rust
/// algorithm inlined via the `sha256` const-fn crate pattern — implemented below.
mod sha256 {
    pub fn digest(data: &[u8]) -> String {
        let hash = hash256(data);
        let mut s = String::with_capacity(64);
        for b in hash {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    fn hash256(msg: &[u8]) -> [u8; 32] {
        // FIPS 180-4 SHA-256
        let mut h: [u32; 8] = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
            0x5be0cd19,
        ];
        let k: [u32; 64] = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
            0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
            0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
            0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
            0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
            0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
            0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
            0xc67178f2,
        ];

        let bit_len = (msg.len() as u64) * 8;
        let mut with_pad = msg.to_vec();
        with_pad.push(0x80);
        while (with_pad.len() % 64) != 56 {
            with_pad.push(0);
        }
        with_pad.extend_from_slice(&bit_len.to_be_bytes());

        for chunk in with_pad.chunks(64) {
            let mut w = [0u32; 64];
            for i in 0..16 {
                w[i] = u32::from_be_bytes([
                    chunk[i * 4],
                    chunk[i * 4 + 1],
                    chunk[i * 4 + 2],
                    chunk[i * 4 + 3],
                ]);
            }
            for i in 16..64 {
                let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
                let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
            }
            let mut a = h[0];
            let mut b = h[1];
            let mut c = h[2];
            let mut d = h[3];
            let mut e = h[4];
            let mut f = h[5];
            let mut g = h[6];
            let mut hh = h[7];
            for i in 0..64 {
                let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
                let ch = (e & f) ^ ((!e) & g);
                let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(k[i]).wrapping_add(w[i]);
                let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
                let maj = (a & b) ^ (a & c) ^ (b & c);
                let t2 = s0.wrapping_add(maj);
                hh = g;
                g = f;
                f = e;
                e = d.wrapping_add(t1);
                d = c;
                c = b;
                b = a;
                a = t1.wrapping_add(t2);
            }
            h[0] = h[0].wrapping_add(a);
            h[1] = h[1].wrapping_add(b);
            h[2] = h[2].wrapping_add(c);
            h[3] = h[3].wrapping_add(d);
            h[4] = h[4].wrapping_add(e);
            h[5] = h[5].wrapping_add(f);
            h[6] = h[6].wrapping_add(g);
            h[7] = h[7].wrapping_add(hh);
        }

        let mut out = [0u8; 32];
        for (i, v) in h.iter().enumerate() {
            out[i * 4..(i + 1) * 4].copy_from_slice(&v.to_be_bytes());
        }
        out
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn empty_sha() {
            assert_eq!(
                super::digest(b""),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            );
        }
    }
}

pub use sha256::digest as sha256_hex_bytes;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_graph_mutation_and_bad_hash() {
        let dir = std::env::temp_dir().join(format!("vmz-plug-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut store = ContributionStore::default();
        let batch = ContributionBatch {
            plugin: PluginIdentity { name: "t".into(), version: "1.0.0".into() },
            protocol: PLUGIN_PROTOCOL_V1.into(),
            stage: PluginStage::WorkspaceResolve,
            cache_key: "k".into(),
            deterministic: true,
            items: vec![
                ContributionItem {
                    id: "mut".into(),
                    kind: ContributionKind::GraphMutation { detail: "nodes.push".into() },
                },
                ContributionItem {
                    id: "src".into(),
                    kind: ContributionKind::Source {
                        path: PathBuf::from("src/x.vmz"),
                        content: "hi".into(),
                        content_hash: "deadbeef".into(),
                        materialize: false,
                    },
                },
            ],
        };
        let report = store.apply_batch(&batch, &dir);
        assert_eq!(report.accepted, 0);
        assert_eq!(report.rejected.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_source_target_and_diffs() {
        let dir = std::env::temp_dir().join(format!("vmz-plug-ok-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let content = "hello";
        let hash = sha256_hex(content.as_bytes());
        let mut store = ContributionStore::default();
        let batch = ContributionBatch {
            plugin: PluginIdentity { name: "demo".into(), version: "0.1.0".into() },
            protocol: PLUGIN_PROTOCOL_V1.into(),
            stage: PluginStage::WorkspaceResolve,
            cache_key: "c1".into(),
            deterministic: true,
            items: vec![ContributionItem {
                id: "virtual".into(),
                kind: ContributionKind::Source {
                    path: PathBuf::from("src/generated.vmz"),
                    content: content.into(),
                    content_hash: hash,
                    materialize: true,
                },
            }],
        };
        let r1 = store.apply_batch(&batch, &dir);
        assert_eq!(r1.accepted, 1);
        assert!(r1.diff.added.iter().any(|k| k.contains("virtual")));
        let written = store.materialize_sources(&dir).unwrap();
        assert_eq!(written.len(), 1);
        assert!(dir.join("src/generated.vmz").is_file());

        let mut batch2 = batch.clone();
        batch2.items.clear();
        let r2 = store.apply_batch(&batch2, &dir);
        assert!(r2.diff.removed.iter().any(|k| k.contains("virtual")));
        let _ = fs::remove_dir_all(&dir);
    }
}

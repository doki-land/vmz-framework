//! Moved from `src/session/plugin.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::PathBuf;

use std::fs;
use vmz_compiler::session::plugin::*;

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

#[test]
fn emit_targets_writes_typed_json_not_hand_built_strings() {
    let dir = std::env::temp_dir().join(format!("vmz-plug-emit-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let mut store = ContributionStore::default();
    let batch = ContributionBatch {
        plugin: PluginIdentity { name: "edge".into(), version: "1.2.3".into() },
        protocol: PLUGIN_PROTOCOL_V1.into(),
        stage: PluginStage::Target,
        cache_key: "t".into(),
        deterministic: true,
        items: vec![ContributionItem {
            id: "preview".into(),
            kind: ContributionKind::Target {
                target_id: "edge-preview".into(),
                target_kind: "edge".into(),
                manifest: serde_json::json!({"runtime":"edge","routes":["/"]}),
            },
        }],
    };
    assert_eq!(store.apply_batch(&batch, &dir).accepted, 1);
    let out = dir.join("dist");
    let emitted = store.emit_targets(&out).unwrap();
    assert!(emitted.iter().any(|p| p.ends_with("edge-preview.json")));
    assert!(emitted.iter().any(|p| p.ends_with("vmz-plugin-targets.json")));

    let doc: PluginTargetDocument = serde_json::from_str(
        &fs::read_to_string(out.join("vmz-targets/edge-preview.json")).unwrap(),
    )
    .expect("typed PluginTargetDocument");
    assert_eq!(doc.schema, PLUGIN_TARGET_SCHEMA);
    assert_eq!(doc.target_id, "edge-preview");
    assert_eq!(doc.kind, "edge");
    assert_eq!(doc.plugin, "edge");
    assert_eq!(doc.plugin_version, "1.2.3");
    assert_eq!(doc.contribution_id, "preview");
    assert_eq!(doc.manifest["runtime"], "edge");

    let summary: PluginTargetsSummary =
        serde_json::from_str(&fs::read_to_string(out.join("vmz-plugin-targets.json")).unwrap())
            .expect("typed PluginTargetsSummary");
    assert_eq!(summary.schema, PLUGIN_TARGETS_SUMMARY_SCHEMA);
    assert_eq!(summary.targets.len(), 1);
    assert_eq!(summary.targets[0].file, "vmz-targets/edge-preview.json");

    let _ = fs::remove_dir_all(&dir);
}

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

//! Moved from `src/tooling/rename.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_protocol::{DxPreviewStatus, RenameIntent, StableIdKind, TextEdit, WorkspaceEditStatus};

use std::fs;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::tooling::rename::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-x1-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn route_id_rename_emits_edits_and_applies() {
    let root = tmp("route");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/Index.vmz"),
        r#"<router>
{ id: "home", path: "/" }
</router>
<template>
  <Link to="home" />
</template>
"#,
    )
    .unwrap();
    let intent = RenameIntent::new(StableIdKind::RouteId, "home", "landing");
    let plan = plan_rename_edits(&root, &intent, StableIdKind::RouteId);
    assert_eq!(plan.status, WorkspaceEditStatus::Ready, "{:?}", plan.diagnostics);
    assert!(plan.edits.len() >= 2, "{:?}", plan.edits);
    let applied = apply_workspace_edits(&root, &plan);
    assert_eq!(applied.status, WorkspaceEditStatus::Applied, "{:?}", applied.diagnostics);
    let text = fs::read_to_string(root.join("src/Index.vmz")).unwrap();
    assert!(text.contains("landing"), "{text}");
    assert!(!text.contains("to=\"home\""), "{text}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn test_edges_select_by_chunk() {
    let root = tmp("tests");
    fs::create_dir_all(root.join("tests")).unwrap();
    fs::write(
        root.join("tests/a.vmz.test.json"),
        r#"{"schema":"vmz.test.manifest.v0","id":"a.test","program":{"chunkId":"pages/index"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("tests/b.vmz.test.json"),
        r#"{"schema":"vmz.test.manifest.v0","id":"b.test","program":{"chunkId":"components/Card"}}"#,
    )
    .unwrap();
    let sel = select_tests_for_chunks(&root, &["pages/index".into()], false);
    assert_eq!(sel.test_ids, vec!["a.test".to_string()]);
    assert_eq!(sel.status, DxPreviewStatus::Ready);
    let _ = fs::remove_dir_all(&root);
}

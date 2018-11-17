//! Moved from `src/tooling/cross_sfc.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::tooling::cross_sfc::*;
use vmz_protocol::{CodeActionKind, RenameIntent, StableIdKind, WorkspaceEditStatus};

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-x2-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn method_and_component_rename_cross_sfc() {
    let root = tmp("cross");
    fs::create_dir_all(root.join("src/components")).unwrap();
    fs::create_dir_all(root.join("src/pages")).unwrap();
    fs::write(
        root.join("src/components/Card.vmz"),
        r#"<template>
  <button @click="increment">{{ n }}</button>
</template>
<script client>
export default class Card {
  n = 0;
  increment() { this.n++; }
}
</script>
"#,
    )
    .unwrap();
    fs::write(
        root.join("src/pages/index.vmz"),
        r#"<template>
  <Card />
</template>
<script client>
export default class IndexPage {}
</script>
"#,
    )
    .unwrap();

    let method = plan_x2_rename(
        &root,
        &RenameIntent::new(StableIdKind::Method, "increment", "bump"),
        StableIdKind::Method,
    );
    assert_eq!(method.status, WorkspaceEditStatus::Ready, "{:?}", method.diagnostics);
    assert!(method.edits.len() >= 2, "{:?}", method.edits);

    let comp = plan_x2_rename(
        &root,
        &RenameIntent::new(StableIdKind::Component, "Card", "Tile"),
        StableIdKind::Component,
    );
    assert_eq!(comp.status, WorkspaceEditStatus::Ready, "{:?}", comp.diagnostics);
    assert!(comp.edits.iter().any(|e| e.path.contains("pages/index")), "{:?}", comp.edits);

    let report = check_cross_sfc(&root);
    assert!(report.index.symbols.iter().any(|s| s.kind() == StableIdKind::Method));
    assert!(report.index.source_map.iter().any(|m| m.symbol_kind == StableIdKind::Method));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn class_stem_mismatch_safe_fix() {
    let root = tmp("fix");
    fs::create_dir_all(root.join("src/components")).unwrap();
    fs::write(
        root.join("src/components/Card.vmz"),
        r#"<template><p>x</p></template>
<script client>
export default class WrongName {}
</script>
"#,
    )
    .unwrap();
    let report = check_cross_sfc(&root);
    assert!(
        report.code_actions.iter().any(|a| a.kind == CodeActionKind::SafeFix),
        "{:?}",
        report.code_actions
    );
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| { d.code_string().as_deref() == Some(DIAG_CLASS_NAME_MISMATCH) })
    );
    let _ = fs::remove_dir_all(&root);
}

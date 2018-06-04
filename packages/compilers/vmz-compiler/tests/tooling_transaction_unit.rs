//! Moved from `src/tooling/transaction.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_protocol::{SemanticTransactionStatus, TextEdit};

use std::fs;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::tooling::transaction::*;

fn tmp() -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-x3-{nanos}"));
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    dir
}

#[test]
fn transaction_rejects_bad_span_without_write() {
    let root = tmp();
    let rel = "src/components/A.vmz";
    let path = root.join(rel);
    fs::write(&path, "<template><p>x</p></template>\n").unwrap();
    let before = fs::read_to_string(&path).unwrap();
    let edits = vec![TextEdit { path: rel.into(), start: 0, end: 9999, new_text: "nope".into() }];
    let doc = apply_semantic_transaction(&root, 1, &edits);
    assert_eq!(doc.status, SemanticTransactionStatus::Rejected);
    assert_eq!(fs::read_to_string(&path).unwrap(), before);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn transaction_commits_two_files() {
    let root = tmp();
    let a = "src/components/A.vmz";
    let b = "src/pages/index.vmz";
    fs::write(root.join(a), "AAAA").unwrap();
    fs::write(root.join(b), "BBBB").unwrap();
    let edits = vec![
        TextEdit { path: a.into(), start: 0, end: 4, new_text: "aaaa".into() },
        TextEdit { path: b.into(), start: 0, end: 4, new_text: "bbbb".into() },
    ];
    let doc = apply_semantic_transaction(&root, 2, &edits);
    assert_eq!(doc.status, SemanticTransactionStatus::Committed);
    assert_eq!(fs::read_to_string(root.join(a)).unwrap(), "aaaa");
    assert_eq!(fs::read_to_string(root.join(b)).unwrap(), "bbbb");
    let _ = fs::remove_dir_all(&root);
}

//! Moved from `src/commands/new.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::PathBuf;

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use vmz_tools::commands::new::*;

fn temp_parent() -> PathBuf {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let p = std::env::temp_dir().join(format!("vmz-new-test-{n}"));
    fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn scaffolds_minimal_app() {
    let parent = temp_parent();
    let prev = std::env::current_dir().unwrap();
    std::env::set_current_dir(&parent).unwrap();
    let result = run(Args { dir: PathBuf::from("demo-app") });
    let _ = std::env::set_current_dir(prev);
    result.unwrap();

    let root = parent.join("demo-app");
    assert!(root.join("package.json").exists());
    assert!(root.join("src/Application.vmz").exists());
    assert!(root.join("src/pages/index.vmz").exists());
    let pkg = fs::read_to_string(root.join("package.json")).unwrap();
    // Runtime heart (`@vmz/core`) ≠ CLI (`@vmz/vmz`).
    assert!(pkg.contains("\"@vmz/core\":"), "runtime dependency missing:\n{pkg}");
    assert!(pkg.contains("\"@vmz/vmz\":"), "CLI devDependency missing:\n{pkg}");
    assert!(pkg.contains("\"name\": \"demo-app\""));
    let _ = fs::remove_dir_all(parent);
}

#[test]
fn rejects_nested_path() {
    let err = run(Args { dir: PathBuf::from("foo/bar") }).unwrap_err();
    assert!(err.to_string().contains("single path segment"));
}

//! Moved from `src/application/reloc.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::DIAG_NON_RELOCATABLE_URL;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::application::reloc::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m1-{label}-{nanos}"));
    fs::create_dir_all(dir.join("src")).unwrap();
    dir
}

#[test]
fn join_and_strip_roundtrip() {
    assert_eq!(join_application_base("/", "/settings").unwrap(), "/settings");
    assert_eq!(
        join_application_base("/examples/counter", "/settings").unwrap(),
        "/examples/counter/settings"
    );
    assert_eq!(join_application_base("/examples/counter", "/").unwrap(), "/examples/counter");
    assert_eq!(
        strip_application_base("/examples/counter", "/examples/counter/settings").unwrap(),
        Some("/settings".into())
    );
    assert_eq!(strip_application_base("/examples/counter", "/other").unwrap(), None);
}

#[test]
fn relocatable_ok_without_bare_urls() {
    let dir = tmp("ok");
    fs::write(
        dir.join("package.json"),
        r#"{
  "name": "@t/counter",
  "vmz": {
"application": {
  "schema": "vmz.application.v0",
  "id": "counter",
  "entryRoute": "counter.home"
}
  }
}"#,
    )
    .unwrap();
    fs::write(
        dir.join("src").join("App.vmz"),
        r#"<template><p>{count}</p></template>
<script client>
export default class App {
  count = 0
  // @vmz-external
  docs = 'https://example.com/docs'
}
</script>
"#,
    )
    .unwrap();
    let report = check_application_relocatable(&dir, Some("/examples/counter"));
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    let settings =
        report.at_relocated.entries.iter().find(|e| e.logical_path == "/settings").unwrap();
    assert_eq!(settings.href, "/examples/counter/settings");
    let home = report.at_root.entries.iter().find(|e| e.logical_path == "/").unwrap();
    assert_eq!(home.href, "/");
}

#[test]
fn bare_absolute_path_is_error() {
    let dir = tmp("bad");
    fs::write(
        dir.join("package.json"),
        r#"{
  "name": "@t/bad",
  "vmz": {
"application": {
  "schema": "vmz.application.v0",
  "id": "bad",
  "entryRoute": "bad.home"
}
  }
}"#,
    )
    .unwrap();
    fs::write(
        dir.join("src").join("x.vmz"),
        r#"<template><a href="/settings">x</a></template>
<script client>
export default class X {
  path = '/assets/logo.png'
}
</script>
"#,
    )
    .unwrap();
    let report = check_application_relocatable(&dir, None);
    assert!(report.has_errors());
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_NON_RELOCATABLE_URL))
    );
}

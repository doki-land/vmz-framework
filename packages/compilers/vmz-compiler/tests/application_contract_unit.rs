//! Moved from `src/application/contract.rs` (cargo-cry: tests next to Cargo.toml).

use std::collections::HashSet;
use std::path::Path;
use vmz_protocol::*;

use std::path::PathBuf;

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::application::contract::*;

fn tmp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m0-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_pkg(root: &Path, name: &str, id: &str) {
    fs::create_dir_all(root).unwrap();
    fs::write(
        root.join("package.json"),
        format!(
            r#"{{
  "name": "{name}",
  "vmz": {{
"application": {{
  "schema": "vmz.application.v0",
  "id": "{id}",
  "entryRoute": "{id}.home",
  "title": "{id}"
}}
  }}
}}"#
        ),
    )
    .unwrap();
}

#[test]
fn resolves_explicit_ids_not_directory_names() {
    let host = tmp_dir("host");
    let child = host.join("packages").join("weird-dir-name");
    write_pkg(&child, "@proj/counter", "counter");
    fs::write(
        host.join(CONFIG_NAME),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [{ id: 'public', groups: [{ id: 'g', applications: ['counter'] }] }],
  mounts: [{ application: 'counter', routeBase: '/examples/counter' }],
}"#,
    )
    .unwrap();

    let report = check_applications(&host, &[child.clone()]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    assert_eq!(report.descriptors[0].id.as_str(), "counter");
    assert_eq!(report.catalog.applications[0].id.as_str(), "counter");
    assert_eq!(report.catalog.applications[0].route_base.as_deref(), Some("/examples/counter"));
}

#[test]
fn unknown_reference_and_mount_collision() {
    let host = tmp_dir("collide");
    let a = host.join("a");
    let b = host.join("b");
    write_pkg(&a, "@p/a", "alpha");
    write_pkg(&b, "@p/b", "beta");
    fs::write(
        host.join(CONFIG_NAME),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [{ id: 'c', groups: [{ id: 'g', applications: ['missing'] }] }],
  mounts: [
{ application: 'alpha', routeBase: '/examples' },
{ application: 'beta', routeBase: '/examples/beta' },
  ],
}"#,
    )
    .unwrap();

    let report = check_applications(&host, &[a, b]);
    assert!(report.has_errors());
    let codes: HashSet<_> = report.diagnostics.iter().map(|d| d.code.as_str()).collect();
    assert!(codes.contains(DIAG_UNKNOWN_REFERENCE));
    assert!(codes.contains(DIAG_MOUNT_COLLISION));
}

#[test]
fn duplicate_application_id() {
    let host = tmp_dir("dup");
    let a = host.join("a");
    let b = host.join("b");
    write_pkg(&a, "@p/a", "counter");
    write_pkg(&b, "@p/b", "counter");
    let report = check_applications(&host, &[a, b]);
    assert!(report.diagnostics.iter().any(|d| d.code == DIAG_DUPLICATE_ID));
}

#[test]
fn catalog_order_follows_config_array_not_package_sort() {
    let host = tmp_dir("order");
    let z = host.join("z-pkg");
    let a = host.join("a-pkg");
    write_pkg(&z, "@p/z", "zebra");
    write_pkg(&a, "@p/a", "aardvark");
    fs::write(
        host.join(CONFIG_NAME),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [{
id: 'public',
groups: [{ id: 'g', applications: ['zebra', 'aardvark'] }],
  }],
  mounts: [],
}"#,
    )
    .unwrap();
    let report = check_applications(&host, &[a, z]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    let ids: Vec<_> = report.catalog.applications.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["zebra", "aardvark"]);
}

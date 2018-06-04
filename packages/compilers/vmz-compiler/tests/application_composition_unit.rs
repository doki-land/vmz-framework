//! Moved from `src/application/composition.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use std::path::Path;
use vmz_protocol::*;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::application::composition::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m4-{label}-{nanos}"));
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
fn host_catalog_and_cross_link_resolution() {
    let host = tmp("host");
    let a = host.join("packages").join("alpha");
    let b = host.join("packages").join("beta");
    write_pkg(&a, "@p/alpha", "alpha");
    write_pkg(&b, "@p/beta", "beta");
    fs::write(
        host.join("applications.config.json5"),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [{ id: 'c', groups: [{ id: 'g', applications: ['beta', 'alpha'] }] }],
  mounts: [
{ application: 'alpha', routeBase: '/apps/alpha' },
{ application: 'beta', routeBase: '/apps/beta' },
  ],
}"#,
    )
    .unwrap();
    fs::create_dir_all(host.join("src")).unwrap();
    fs::write(
        host.join("src").join("Index.vmz"),
        r#"<template>
  <Link application="alpha" to="alpha.home" />
  <Link application="beta" to="beta.home" />
</template>
"#,
    )
    .unwrap();

    let report = check_application_host_composition(&host, &[a, b]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    assert_eq!(report.catalog_order_source, "config-array");
    let ids: Vec<_> = report.catalog.applications.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["beta", "alpha"]);
    assert!(report.forbidden_product_kinds.contains(&"homepage".into()));
    assert_eq!(report.cross_application_links.len(), 2);
    let alpha = report
        .cross_application_links
        .iter()
        .find(|l| l.application_id.as_str() == "alpha")
        .unwrap();
    assert_eq!(alpha.href.as_deref(), Some("/apps/alpha"));
    assert!(alpha.document_navigation);
}

#[test]
fn non_public_route_and_unknown_app_fail() {
    let host = tmp("bad");
    let a = host.join("packages").join("alpha");
    write_pkg(&a, "@p/alpha", "alpha");
    fs::write(
        host.join("applications.config.json5"),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [],
  mounts: [{ application: 'alpha', routeBase: '/apps/alpha' }],
}"#,
    )
    .unwrap();
    fs::write(
        host.join("cross-links.json"),
        r#"[{"application":"alpha","to":"alpha.secret"},{"application":"ghost","to":"ghost.home"}]"#,
    )
    .unwrap();
    let report = check_application_host_composition(&host, &[a]);
    assert!(report.has_errors());
    let codes: std::collections::HashSet<_> =
        report.diagnostics.iter().filter_map(|d| d.code_string()).collect();
    assert!(codes.contains(DIAG_ROUTE_NOT_PUBLIC));
    assert!(codes.contains(DIAG_UNKNOWN_REFERENCE));
}

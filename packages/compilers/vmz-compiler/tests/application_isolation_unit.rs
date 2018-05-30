//! Moved from `src/application/isolation.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use std::path::PathBuf;

use vmz_compiler::application::isolation::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m3-{label}-{nanos}"));
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
fn isolation_namespaces_and_failure_containment() {
    let host = tmp("host");
    let a = host.join("packages").join("alpha");
    let b = host.join("packages").join("beta");
    write_pkg(&a, "@p/alpha", "alpha");
    write_pkg(&b, "@p/beta", "beta");
    fs::write(
        host.join("applications.config.json5"),
        r#"{
  schema: 'vmz.applications.v0',
  collections: [{ id: 'c', groups: [{ id: 'g', applications: ['alpha', 'beta'] }] }],
  mounts: [
{ application: 'alpha', routeBase: '/apps/alpha' },
{ application: 'beta', routeBase: '/apps/beta' },
  ],
}"#,
    )
    .unwrap();
    let report = check_application_isolation(&host, &[a, b]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    assert_eq!(report.surfaces.len(), 8);
    assert_eq!(report.namespaces.len(), 2);
    let alpha = report.namespaces.iter().find(|n| n.application_id.as_str() == "alpha").unwrap();
    assert_eq!(alpha.style, "vmz:style:alpha");
    assert_eq!(alpha.session, "vmz:session:alpha");
    assert!(alpha.runtime.contains("alpha"));
    assert_eq!(report.failure_containment.len(), 2);
    let fail_a = report
        .failure_containment
        .iter()
        .find(|p| p.failed_application_id.as_str() == "alpha")
        .unwrap();
    assert!(fail_a.host_survives);
    assert!(fail_a.siblings_survive.iter().any(|s| s.as_str() == "beta"));
    assert_eq!(fail_a.unavailable.status, 503);
}

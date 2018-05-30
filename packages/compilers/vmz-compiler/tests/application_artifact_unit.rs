//! Moved from `src/application/artifact.rs` (cargo-cry: tests next to Cargo.toml).

use std::collections::HashSet;
use std::path::Path;

use std::path::PathBuf;

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::application::artifact::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m2-{label}-{nanos}"));
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
fn artifacts_are_independent_and_mount_table_is_refs_only() {
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
    let report = check_application_artifact_boundary(&host, &[a, b]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    assert_eq!(report.artifacts.len(), 2);
    let hashes: HashSet<_> =
        report.artifacts.iter().map(|x| x.program_graph_ref.hash.as_str()).collect();
    assert_eq!(hashes.len(), 2);
    let mt = serde_json::to_string(&report.mount_table).unwrap();
    assert!(!mt.contains("programGraph"));
    assert!(mt.contains("artifactRef"));
    assert_eq!(
        report.mount_table.mounts[0].artifact_ref.hash,
        report
            .artifacts
            .iter()
            .find(|x| x.application_id.as_str()
                == report.mount_table.mounts[0].application_id.as_str())
            .unwrap()
            .integrity
    );
}

//! Moved from `src/application/dev.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use std::path::Path;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::application::dev::*;

fn tmp(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-m5-{label}-{nanos}"));
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
fn child_source_rebuilds_only_that_app() {
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
    fs::create_dir_all(a.join("src")).unwrap();
    let dirty = a.join("src").join("Index.vmz");
    fs::write(&dirty, "<template>x</template>").unwrap();
    fs::write(host.join("unavailable-applications.json"), r#"["beta"]"#).unwrap();

    let report = check_application_dev_test_deploy(&host, &[a.clone(), b.clone()], &[dirty]);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
    assert!(report.sessions.sessions.iter().all(|s| s.independent));
    assert_eq!(report.sessions.sessions.len(), 3);
    let rebuilt: Vec<_> = report.affected.units.iter().map(|u| u.application_id.as_str()).collect();
    assert_eq!(rebuilt, vec!["alpha"]);
    assert!(report.affected.not_rebuilt.iter().any(|id| id.as_str() == "beta"));
    let beta_case = report.proxy.cases.iter().find(|c| c.url == "/apps/beta").unwrap();
    assert_eq!(beta_case.status, 503);
    assert_eq!(beta_case.reason.as_deref(), Some("application_unavailable"));
    assert!(report.deploy.mount_table_refs_only);
    assert_eq!(
        report.tests.mounted.contracts,
        vec!["relocation".to_string(), "host_boundary".to_string()]
    );
}

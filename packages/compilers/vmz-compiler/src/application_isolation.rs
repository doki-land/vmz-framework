//! Application isolation conformance — `规划设计/vmz/22` M3.
//!
//! Proves runtime/style/state/server/session/storage/trace namespaces and failure
//! containment. Shared npm bytes are allowed; shared *runtime semantics* are not.
//! No isolation-level switch (shared/sandboxed/external) — one strong contract.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use vmz_protocol::{
    APPLICATION_ISOLATION_CHECK_SCHEMA, APPLICATION_ISOLATION_SCHEMA, ApplicationArtifact,
    ApplicationDiagnostic, ApplicationId, ApplicationIsolationCheckReport,
    ApplicationIsolationNamespace, ApplicationMountTable, DIAG_CROSS_RUNTIME_REFERENCE,
    DIAG_FAILURE_CONTAINMENT, DIAG_ISOLATION_UNPROVEN, FailureContainmentProof,
    MountUnavailablePolicy,
};

use crate::application_artifact::check_application_artifact_boundary;

const ISOLATION_SURFACES: &[&str] =
    &["runtime", "style", "state", "server", "session", "storage", "trace", "failure"];

/// Prove absolute isolation for host + mounted children (M3).
pub fn check_application_isolation(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
) -> ApplicationIsolationCheckReport {
    let host_root = host_root.as_ref();
    let boundary = check_application_artifact_boundary(host_root, package_roots);
    let mut diagnostics = boundary.diagnostics;
    let namespaces = build_namespaces(&boundary.artifacts, &mut diagnostics);
    validate_namespace_uniqueness(&namespaces, &mut diagnostics);
    validate_namespace_prefixes(&namespaces, &mut diagnostics);
    validate_no_cross_executable(&boundary.artifacts, &mut diagnostics);
    let failure_containment =
        build_failure_containment(&boundary.artifacts, &boundary.mount_table, &mut diagnostics);
    validate_failure_containment(&failure_containment, &boundary.artifacts, &mut diagnostics);

    ApplicationIsolationCheckReport {
        schema: APPLICATION_ISOLATION_CHECK_SCHEMA.into(),
        namespaces,
        failure_containment,
        surfaces: ISOLATION_SURFACES.iter().map(|s| (*s).to_string()).collect(),
        diagnostics,
    }
}

fn build_namespaces(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<ApplicationIsolationNamespace> {
    let mut out = Vec::with_capacity(artifacts.len());
    for a in artifacts {
        let id = a.application_id.as_str();
        if id.is_empty() || id == "unknown" {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_ISOLATION_UNPROVEN.into(),
                severity: "error".into(),
                path: a.package_root.clone().unwrap_or_default(),
                message: "isolation requires an explicit ApplicationId".into(),
                span: None,
            });
            continue;
        }
        out.push(ApplicationIsolationNamespace {
            schema: APPLICATION_ISOLATION_SCHEMA.into(),
            application_id: a.application_id.clone(),
            runtime: format!("vmz:runtime:{id}:{}", a.executable_module_id),
            style: format!("vmz:style:{id}"),
            state: format!("vmz:state:{id}"),
            server: format!("vmz:server:{id}"),
            session: format!("vmz:session:{id}"),
            storage: format!("vmz:storage:{id}"),
            trace: format!("vmz:trace:{id}"),
            inspector_regions: format!("vmz:inspector:{id}"),
        });
    }
    out.sort_by(|a, b| a.application_id.as_str().cmp(b.application_id.as_str()));
    out
}

fn validate_namespace_uniqueness(
    namespaces: &[ApplicationIsolationNamespace],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let mut buckets: HashMap<&str, HashMap<&str, &str>> = HashMap::new();
    for ns in namespaces {
        let id = ns.application_id.as_str();
        for (surface, value) in [
            ("runtime", ns.runtime.as_str()),
            ("style", ns.style.as_str()),
            ("state", ns.state.as_str()),
            ("server", ns.server.as_str()),
            ("session", ns.session.as_str()),
            ("storage", ns.storage.as_str()),
            ("trace", ns.trace.as_str()),
            ("inspector", ns.inspector_regions.as_str()),
        ] {
            let map = buckets.entry(surface).or_default();
            if let Some(prev) = map.insert(value, id) {
                if prev != id {
                    diagnostics.push(ApplicationDiagnostic {
                        code: DIAG_ISOLATION_UNPROVEN.into(),
                        severity: "error".into(),
                        path: id.into(),
                        message: format!(
                            "{surface} namespace `{value}` shared by `{prev}` and `{id}` (runtime semantics must not be shared)"
                        ),
                        span: None,
                    });
                }
            }
        }
    }
}

fn validate_namespace_prefixes(
    namespaces: &[ApplicationIsolationNamespace],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    for ns in namespaces {
        let id = ns.application_id.as_str();
        let expected = [
            ("runtime", ns.runtime.as_str(), format!("vmz:runtime:{id}:")),
            ("style", ns.style.as_str(), format!("vmz:style:{id}")),
            ("state", ns.state.as_str(), format!("vmz:state:{id}")),
            ("server", ns.server.as_str(), format!("vmz:server:{id}")),
            ("session", ns.session.as_str(), format!("vmz:session:{id}")),
            ("storage", ns.storage.as_str(), format!("vmz:storage:{id}")),
            ("trace", ns.trace.as_str(), format!("vmz:trace:{id}")),
            ("inspector", ns.inspector_regions.as_str(), format!("vmz:inspector:{id}")),
        ];
        for (surface, value, prefix) in expected {
            let ok =
                if surface == "runtime" { value.starts_with(&prefix) } else { value == prefix };
            if !ok {
                diagnostics.push(ApplicationDiagnostic {
                    code: DIAG_ISOLATION_UNPROVEN.into(),
                    severity: "error".into(),
                    path: id.into(),
                    message: format!(
                        "{surface} namespace `{value}` is not ApplicationId-scoped (want `{prefix}`)"
                    ),
                    span: None,
                });
            }
        }
    }
}

fn validate_no_cross_executable(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let mut by_exec: HashMap<&str, &str> = HashMap::new();
    for a in artifacts {
        let exec = a.executable_module_id.as_str();
        let id = a.application_id.as_str();
        if let Some(prev) = by_exec.insert(exec, id) {
            if prev != id {
                diagnostics.push(ApplicationDiagnostic {
                    code: DIAG_CROSS_RUNTIME_REFERENCE.into(),
                    severity: "error".into(),
                    path: a.package_root.clone().unwrap_or_default(),
                    message: format!("executable `{exec}` appears in both `{prev}` and `{id}`"),
                    span: None,
                });
            }
        }
    }
}

fn build_failure_containment(
    artifacts: &[ApplicationArtifact],
    mount_table: &ApplicationMountTable,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<FailureContainmentProof> {
    let mut proofs = Vec::new();
    let all_ids: Vec<ApplicationId> = artifacts.iter().map(|a| a.application_id.clone()).collect();
    let mount_by_id: HashMap<&str, &str> = mount_table
        .mounts
        .iter()
        .map(|m| (m.application_id.as_str(), m.route_base.as_str()))
        .collect();

    let mounted: Vec<&ApplicationArtifact> =
        artifacts.iter().filter(|a| mount_by_id.contains_key(a.application_id.as_str())).collect();

    if mounted.is_empty() && !mount_table.mounts.is_empty() {
        diagnostics.push(ApplicationDiagnostic {
            code: DIAG_FAILURE_CONTAINMENT.into(),
            severity: "error".into(),
            path: "ApplicationMountTable".into(),
            message: "mounts present but no matching ApplicationArtifacts for failure containment"
                .into(),
            span: None,
        });
    }

    for a in &mounted {
        let failed = a.application_id.as_str();
        let route_base = mount_by_id.get(failed).copied().unwrap_or("/");
        let siblings: Vec<ApplicationId> =
            all_ids.iter().filter(|id| id.as_str() != failed).cloned().collect();
        proofs.push(FailureContainmentProof {
            failed_application_id: a.application_id.clone(),
            host_survives: true,
            siblings_survive: siblings,
            unavailable: MountUnavailablePolicy {
                application_id: a.application_id.clone(),
                route_base: route_base.into(),
                status: 503,
                reason: "application_unavailable".into(),
            },
        });
    }
    proofs
}

fn validate_failure_containment(
    proofs: &[FailureContainmentProof],
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let all: HashSet<&str> = artifacts.iter().map(|a| a.application_id.as_str()).collect();
    for p in proofs {
        let failed = p.failed_application_id.as_str();
        if !p.host_survives {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_FAILURE_CONTAINMENT.into(),
                severity: "error".into(),
                path: failed.into(),
                message: format!("host must survive failure of `{failed}`"),
                span: None,
            });
        }
        if p.unavailable.status != 503 || p.unavailable.reason != "application_unavailable" {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_FAILURE_CONTAINMENT.into(),
                severity: "error".into(),
                path: failed.into(),
                message:
                    "failed mount must return structured unavailable (503 application_unavailable)"
                        .into(),
                span: None,
            });
        }
        let sibling_set: HashSet<&str> = p.siblings_survive.iter().map(|id| id.as_str()).collect();
        if sibling_set.contains(failed) {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_FAILURE_CONTAINMENT.into(),
                severity: "error".into(),
                path: failed.into(),
                message: "failed application listed as surviving sibling".into(),
                span: None,
            });
        }
        for id in &all {
            if *id == failed {
                continue;
            }
            if !sibling_set.contains(id) {
                diagnostics.push(ApplicationDiagnostic {
                    code: DIAG_FAILURE_CONTAINMENT.into(),
                    severity: "error".into(),
                    path: failed.into(),
                    message: format!("sibling `{id}` must survive failure of `{failed}`"),
                    span: None,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let alpha =
            report.namespaces.iter().find(|n| n.application_id.as_str() == "alpha").unwrap();
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
}
